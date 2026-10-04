# Attendly deployment

Attendly ships as two containers plus PostgreSQL, so a production deployment is
one host running `docker-compose.prod.yml` behind Caddy (automatic HTTPS) and one
command to release: `./scripts/deploy.sh`.

- [Local Docker quickstart](#local-docker-quickstart-powershell)
- [Try the production stack locally](#try-the-production-stack-locally)
- [Deploy to AWS (single EC2 host)](#deploy-to-aws-single-ec2-host)
- [Backups and restore](#backups-and-restore)
- [Redeploy and roll back](#redeploy-and-roll-back)
- [Logs, health and monitoring](#logs-health-and-monitoring)
- [Security model in production](#security-model-in-production)
- [Alternative topologies](#alternative-topologies)
- [Teardown](#teardown)
- [Production configuration reference](#production-configuration-reference)

## Local Docker quickstart (PowerShell)

```powershell
Copy-Item .env.example .env
# Edit .env: use long random POSTGRES_PASSWORD and CSRF_SECRET.
docker compose up --build -d
docker compose --profile demo run --rm demo-seed
Start-Process http://localhost:3000
```

The first command builds both multi-stage images, waits for PostgreSQL readiness, applies the committed Prisma migrations, then starts Express and Next. The database is only on the private Compose network. The demo profile is opt-in and requires `DEMO_PASSWORD` (12+ characters); it creates `teacher@attendly.local` and `student@attendly.local` using that password, plus a demo course with lectures, attendance and noticeboard posts. Never enable that profile in production. If you change `apps/api/prisma/seed.ts`, rebuild the seed service with `docker compose --profile demo run --rm --build demo-seed`; `docker compose up --build` does not rebuild the demo profile.

## Try the production stack locally

Before paying for a server, run the real production stack on your own machine.
Caddy issues itself a certificate for `localhost` and the ports move to 8080/8443
so nothing collides:

```bash
bash scripts/gen-env.sh localhost --local      # writes .env.production
bash scripts/deploy.sh local-smoke             # build, migrate, start, health-check
curl -k https://localhost:8443/api/health      # {"status":"ok","database":"connected"}
curl -k https://localhost:8443/healthz         # ok
```

Then open `https://localhost:8443` (accept the self-signed certificate), sign up,
mark some attendance, and try the rest of this document:

```bash
bash scripts/backup.sh
bash scripts/restore.sh --target attendly_drill --yes backups/attendly-*.sql.gz
bash scripts/rollback.sh
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

Delete `.env.production` afterwards: it is generated per host, and a `localhost`
copy left in place would silently be used by a later real deployment.

## Deploy to AWS (single EC2 host)

### What this deploys

```
                 Internet
                    │  80 + 443 only
             ┌──────▼───────┐
             │    caddy     │  TLS, HSTS, gzip, HTTP→HTTPS redirect
             └──────┬───────┘
                    │ private compose network
             ┌──────▼───────┐        ┌────────────┐
             │     web      │───────▶│    api     │
             │  Next.js :3000│  /api  │ Express:4000│
             └──────────────┘        └──────┬─────┘
                                            │
                                     ┌──────▼─────┐
                                     │     db      │  postgres:17, no ports
                                     │  :5432      │  published
                                     └─────────────┘
```

One `t3.small`-class instance, one encrypted EBS volume, one Elastic IP. No load
balancer, no NAT gateway, no managed database — the cheapest shape that still
gives you real HTTPS and a documented rollback.

### 1. Prerequisites

- An AWS account (a fresh one is in the free tier for 12 months, which covers a
  `t3.micro`; the build needs a `t3.small` — see [cost](#cost)).
- A domain you can add a DNS record to. HTTPS is issued by Let's Encrypt over
  HTTP-01, so the record must exist **before** the first deploy.
- AWS CLI v2 installed and configured (`aws configure`), or use the console
  equivalents in the AWS docs. Every command below assumes `$AWS_REGION`.

```bash
export AWS_REGION=ap-south-1        # pick the region closest to your students
aws sts get-caller-identity         # confirms credentials work
```

### 2. Create the host

```bash
# Ubuntu 24.04 LTS AMI for your region, looked up instead of hard-coded.
AMI=$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query Parameter.Value --output text)

# SSH key pair.
aws ec2 create-key-pair --key-name attendly \
  --query KeyMaterial --output text > attendly.pem
chmod 400 attendly.pem

# Security group: SSH from your address only, web from anywhere.
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name attendly-web \
  --description "Attendly web" --vpc-id "$VPC" --query GroupId --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22  --cidr "$MY_IP/32"
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0

# 30 GB encrypted gp3, and cloud-init from this repository.
INSTANCE=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type t3.small \
  --key-name attendly --security-group-ids "$SG" \
  --user-data file://scripts/ec2-user-data.sh \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=attendly}]' \
  --query 'Instances[0].InstanceId' --output text)

# A fixed public address: without this, rebooting changes the IP and breaks DNS.
ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC"
aws ec2 describe-addresses --allocation-ids "$ALLOC" \
  --query 'Addresses[0].PublicIp' --output text       # ← your server IP
```

`scripts/ec2-user-data.sh` installs Docker Engine + Compose, adds a 2 GB swap
file (the Next.js production build needs more memory than a 2 GB instance has
free), enables unattended security upgrades, caps container and journald logs,
creates `/srv/attendly`, and installs the nightly backup cron. Give it two or
three minutes, then connect:

```bash
ssh -i attendly.pem ubuntu@<server-ip>
docker --version && docker compose version
```

If `docker` says permission denied, the group change has not applied to your
login yet: reconnect (`exit`, then `ssh` again) or run `newgrp docker`.

### 3. Point DNS at it

```bash
# Route 53 (skip if your domain lives elsewhere — add an A record there instead).
HOSTED=$(aws route53 list-hosted-zones \
  --query "HostedZones[?Name=='example.com.'].Id" --output text | cut -d/ -f3)
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED" --change-batch '{
  "Changes": [{"Action": "UPSERT", "ResourceRecordSet": {
    "Name": "attendly.example.com", "Type": "A", "TTL": 300,
    "ResourceRecords": [{"Value": "<server-ip>"}]}}]}'
```

Confirm before continuing — a failed ACME challenge will otherwise burn rate
limit on repeated deploys:

```bash
dig +short attendly.example.com
```

### 4. Put the code on the host

This project is not a git repository yet. Either push it to GitHub and clone it
(nicer: you get `git log` on the server, and `git pull` before a deploy), or copy
the working tree over SSH. From Git Bash on Windows:

```bash
ssh -i attendly.pem ubuntu@<server-ip> 'mkdir -p /srv/attendly'
tar -czf - \
  --exclude node_modules --exclude .next --exclude dist \
  --exclude .env --exclude .env.production --exclude backups --exclude .deploy \
  . | ssh -i attendly.pem ubuntu@<server-ip> 'tar -xzf - -C /srv/attendly'
```

Do not copy a local `.env`.

### 5. Configure secrets

```bash
ssh -i attendly.pem ubuntu@<server-ip>
cd /srv/attendly
./scripts/gen-env.sh attendly.example.com you@example.com
# then set the bootstrap teacher you want (optional, see step 7)
nano .env.production
```

`gen-env.sh` writes 48 hex characters of database password and 64 of CSRF
secret, sets `WEB_ORIGIN` to `https://attendly.example.com`, turns on
`COOKIE_SECURE`, and locks the file to `0600`. Keep a copy of this file in a
password manager or AWS Secrets Manager: it is the only copy of the database
password.

### 6. Deploy

```bash
cd /srv/attendly
./scripts/deploy.sh                 # or: bash scripts/deploy.sh
```

The script tags the currently running images (so it can go back), builds the new
release, runs `prisma migrate deploy`, starts everything, and only reports
success once `https://<domain>/healthz` and `/api/health` answer over real TLS.
If anything fails it restores the previous release on its own. First run takes a
few minutes because both images build on the instance.

```bash
curl https://attendly.example.com/healthz
curl https://attendly.example.com/api/health
```

### 7. Create the first teacher

Teacher accounts cannot be created through public signup by design.

```bash
# Either fill TEACHER_NAME / TEACHER_EMAIL / TEACHER_PASSWORD in .env.production and run:
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile admin run --rm create-teacher

# Or pass the values directly:
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile admin run --rm create-teacher \
  npx tsx prisma/create-teacher.ts "Aarav Mehta" aarav@university.edu "a-long-password"
```

Re-running it for an existing email promotes that account to TEACHER and resets
its password, which is also the admin password-recovery path. Teachers then sign
in at your domain, create courses, and share the join code; students self-register
with their PRN.

## Backups and restore

Cloud-init installs a nightly dump at 03:15 into `/srv/attendly/backups`
(newest 14 kept, ~4 KB compressed for a small database):

```bash
tail -20 /var/log/attendly-backup.log     # confirm it ran
./scripts/backup.sh                       # run one now
```

**A backup you have never restored is a guess.** Practise the drill on a scratch
database, which leaves production untouched:

```bash
./scripts/restore.sh --target attendly_drill --yes backups/attendly-<stamp>.sql.gz
# ✓ Data loaded into attendly_drill
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec db dropdb -U attendly attendly_drill
```

A real restore (replaces every table, stops the API first, health-checks after):

```bash
./scripts/restore.sh backups/attendly-<stamp>.sql.gz     # prompts for the db name
```

Off-site copies (recommended — an EBS volume and its backup are not independent
if ransomware or a fat-fingered `docker volume rm` is the threat):

```bash
BUCKET=attendly-backups-<your-account-id>
aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Install the AWS CLI on the host (`sudo snap install aws-cli --classic`), give the
instance an IAM role whose only permission is `s3:PutObject` on that bucket, then
make the nightly job upload:

```bash
# /etc/cron.d/attendly-backup — add BACKUP_S3_BUCKET=<bucket>
15 3 * * * ubuntu cd /srv/attendly && BACKUP_S3_BUCKET=<bucket> ./scripts/backup.sh >> /var/log/attendly-backup.log 2>&1
```

Also snapshot the volume from time to time, so a corrupted database cannot take
the backups down with it:

```bash
aws ec2 create-snapshot --volume-id <vol-id> --description "attendly $(date -u +%F)"
```

## Redeploy and roll back

```bash
cd /srv/attendly
git pull                     # if you keep the code in git
./scripts/deploy.sh          # release id = UTC timestamp, or pass your own
```

Releases are image tags (`attendly/api:<release>`). `deploy.sh` keeps the current
release, the images captured just before the deploy, and the three newest
releases, then deletes older ones so a 30 GB disk never fills.

```bash
./scripts/rollback.sh                  # newest earlier release
./scripts/rollback.sh 20261003-124500  # or a specific tag
docker images 'attendly/*'             # what is still available locally
```

Rollback is fast (no rebuild, just a retag and restart) because the previous
images are still on the host. That is also why the prune step is deliberately
conservative.

If a deploy fails, the output tells you which stage failed and prints the exact
`logs` command to inspect:

```
✗ Database migration failed (exit 1).
  Inspect it: docker compose -f docker-compose.prod.yml --env-file .env.production logs migrate
→ Restoring the previous release…
✓ Rolled back: the previous release is serving again at https://attendly.example.com
```

## Logs, health and monitoring

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f --tail 100 api
docker stats --no-stream            # memory and CPU per container
df -h /                             # disk: the usual first cause of outages
```

Container logs are capped at 10 MB × 5 files per service and journald at 200 MB,
so logs cannot quietly fill the volume.

- **External uptime**: point any monitor (UptimeRobot, CloudWatch Synthetics,
  Healthchecks.io) at `https://<domain>/healthz` — it returns `ok` without
  touching the database — or at `/api/health`, which returns 503 when PostgreSQL
  is unreachable.
- **Instance alarms**:

```bash
aws cloudwatch put-metric-alarm --alarm-name attendly-status \
  --namespace AWS/EC2 --metric-name StatusCheckFailed --statistic Maximum \
  --period 60 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 2 --dimensions Name=InstanceId,Value="$INSTANCE" \
  --alarm-actions <sns-topic-arn>
```

- **Disk**: add a CloudWatch agent alarm on `disk_used_percent`, or check
  `df -h /` in your monitoring rotation. Images and the database share one volume.

### Sign-in fails with "Something went wrong" (HTTP 500)

That message is the API's generic production 500 handler, so the real cause is in
`docker logs attendly-prod-api-1`. A `P2021` line means Prisma queried a table
that does not exist, which almost always means the `migrate` service applied
nothing:

```bash
docker logs attendly-prod-api-1 --tail 50
docker logs attendly-prod-migrate-1 --tail 30
docker exec attendly-prod-db-1 psql -U attendly -d attendly \
  -c 'select migration_name, finished_at from _prisma_migrations;'
```

If the migrate log says `No migration found in prisma/migrations` while the files
are present on the host, the `prisma/migrations` directory is not readable by the
container user (`appuser`, uid 1001). Copying the tree from Windows or a
restricted source can carry mode `700` on directories. The Dockerfile now runs
`chmod -R a+rX ./prisma` after copying, so a fresh build is immune; to repair an
already-broken host image, fix the source permissions and redeploy:

```bash
chmod -R a+rX /srv/attendly/apps/api/prisma
./scripts/deploy.sh <new-release-tag>
```

If a migration was recorded as failed (Prisma `P3009`, "migrate found failed
migrations"), `prisma migrate deploy` refuses to continue. Confirm whether the
schema actually landed before deciding how to recover:

- **Tables are missing or half-built** — the cleanest fix is to restore a known
  good dump, which also rewrites `_prisma_migrations`:
  `./scripts/restore.sh --yes backups/<dump>.sql.gz`
- **Schema is complete and only the bookkeeping row is wrong** — mark the
  migration resolved, then redeploy:
  `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --entrypoint sh migrate -c 'npx prisma migrate resolve --applied <migration-name>'`

## Security model in production

Already handled by this stack:

- PostgreSQL and the API publish **no** host ports; only Caddy listens publicly,
  and only 80/443 are open in the security group.
- TLS with automatic renewal, HTTP→HTTPS redirect, HSTS, `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`; the `Server` banner is removed.
- Opaque HttpOnly session cookies with `Secure` and `SameSite=Lax`, CSRF
  double-submit tokens, and `Origin` validation on every mutation.
- bcrypt password hashes, strict role-based access control, students cannot write
  attendance through any route, teacher resources are ownership-scoped, and every
  manual attendance change is audited.
- Credential endpoints are rate limited; the API trusts exactly one proxy hop so
  client IPs and rate limits stay correct behind Caddy.
- Both application images run as non-root users; the EBS volume is encrypted.

Your side of the deal:

- **Patch the OS.** `unattended-upgrades` is installed; confirm it is running
  (`systemctl status unattended-upgrades`) and reboot after kernel updates.
- **Do not rely on `ufw` to constrain Docker.** Docker writes its own iptables
  rules that bypass it; the security group is the real boundary. That is also why
  nothing but Caddy publishes ports.
- **SSH**: keep port 22 restricted to your IP, or move to SSM Session Manager and
  close 22 entirely.
- **Rotate secrets** if `.env.production` is ever exposed (change
  `POSTGRES_PASSWORD` in both the file and the database, and `CSRF_SECRET`), then
  redeploy.
- **Test restores**, not just backups. The drill above is the whole reason the
  `--target` flag exists.
- **Add a WAF or ALB** if the site becomes a target for volume attacks; the
  application is deliberately a single host today.

## Alternative topologies

- **ALB + ACM instead of Caddy**: terminate TLS at the load balancer, point it at
  the instance, and add `ports: ["127.0.0.1:3000:3000"]` to the `web` service so
  only the load balancer (via the security group) can reach it. Costs roughly
  $16/month more, and gives you managed certificates and health-check integration.
- **Managed PostgreSQL (RDS)**: point `POSTGRES_*` at RDS, drop the `db` service,
  and rely on automated backups and point-in-time recovery. Adds about
  $15/month (db.t4g.micro) and removes the restore drill from your job.
- **ECS Fargate**: worth it when you need more than one host or zero-downtime
  deploys. Compose does not translate directly, so treat it as a rebuild of this
  stack (task definitions, ALB, ECR, secrets from SSM) rather than a lift.
- **ARM (`t4g.small`)**: about 20% cheaper and builds natively on the instance.
  Keep one architecture per host; do not mix ARM and x86 images between machines.

## Teardown

```bash
# On the host, after a final backup:
./scripts/backup.sh
docker compose -f docker-compose.prod.yml --env-file .env.production down -v

# Snapshot the volume, then remove the AWS resources.
aws ec2 create-snapshot --volume-id <vol-id> --description "attendly final"
aws ec2 terminate-instances --instance-ids "$INSTANCE"
aws ec2 release-address --allocation-id "$ALLOC"
aws ec2 delete-security-group --group-id "$SG"
aws ec2 delete-key-pair --key-name attendly
```

`down -v` deletes the database volume. Terminating the instance also deletes its
volumes unless `DeleteOnTermination` is false. Both are irreversible; keep the
dump and the snapshot.

## Production configuration reference

| Variable | Prod value | Why |
| --- | --- | --- |
| `DOMAIN` | `attendly.example.com` | Caddy requests the certificate for exactly this name |
| `ACME_EMAIL` | your address | Let's Encrypt expiry warnings |
| `WEB_ORIGIN` | `https://attendly.example.com` | Must equal the browser origin or CSRF `Origin` checks fail |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Host ports Caddy binds |
| `POSTGRES_PASSWORD` | 48 random hex chars | Interpolated into `DATABASE_URL`, so hex only |
| `CSRF_SECRET` | 64 random hex chars | API refuses to boot in production without a strong value |
| `COOKIE_SECURE` | `true` | Session cookies are only sent over TLS |
| `RELEASE` | image tag | Written by `deploy.sh`; `rollback.sh` repoints it |
| `TEACHER_*` | bootstrap teacher | Used only by the `admin` profile |

## Operations reference

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
./scripts/deploy.sh                     # release
./scripts/rollback.sh                   # undo a release
./scripts/backup.sh                     # dump now
./scripts/restore.sh --target drill --yes backups/<dump>.sql.gz
docker compose -f docker-compose.prod.yml --env-file .env.production down     # keeps volumes
docker compose -f docker-compose.prod.yml --env-file .env.production down -v  # DELETES the database
```

Attendance records have a unique `(sessionId, studentId)` constraint; teachers
schedule lectures, mark them manually, and every manual change is recorded in the
audit table with a reason. Students have no self-check-in, no QR flow and no
attendance-writing endpoints at all — the API rejects any student attempt to
schedule a lecture, mark attendance, read teacher analytics or author noticeboard
posts with 403. Noticeboard posts store link URLs only; no file uploads or object
storage are required, and profile photos are inline data URLs on the user row.
