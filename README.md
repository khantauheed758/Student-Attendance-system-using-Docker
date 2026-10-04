# Attendly — Student Attendance Management

> **Created and managed by Tauheed Khan** — JNEC Aurangabad · khantauheed759@gmail.com
>
> © 2026 Tauheed Khan. All rights reserved. See [LICENSE](LICENSE).

A Docker-ready MCA project using Next.js App Router, TypeScript, Tailwind, Express, Prisma and PostgreSQL. The interface has responsive teacher/student workspaces, dark mode, charts, enrollment codes, course progress rings, and a monthly attendance calendar.

Attendance is **entirely teacher-controlled**. Teachers schedule lectures, open a live session and mark each enrolled student Present, Late, Absent or Excused; students have strictly read-only dashboards. There is no QR code, no camera scanning and no student self-check-in. Teachers also get subject-aggregated live analytics and a noticeboard for pushing announcements and study-material links to their students.

## Start

1. Start Docker Desktop (Linux containers).
2. Copy `.env.example` to `.env`. Replace the database password and the CSRF signing secret with distinct random values. Use URL-safe database passwords, or percent-encode credentials in database URLs.
3. Run `docker compose up --build -d`.
4. For local demo accounts, set `DEMO_PASSWORD` in `.env` (12+ characters), then run `docker compose --profile demo run --rm demo-seed`.
5. Open **http://localhost:3000**. Demo emails: `teacher@attendly.local` and `student@attendly.local`. Both use your chosen `DEMO_PASSWORD`.

Do not seed a real production database. Public registration creates students only. Teacher accounts are provisioned, not self-assigned. See `DEPLOYMENT.md` for deployment details.

## Deploy

A production deployment is one host running `docker-compose.prod.yml` behind Caddy, which terminates TLS with automatic Let's Encrypt certificates. It is a single command, health-gated, and rolls itself back if a release does not come up:

```bash
./scripts/gen-env.sh attendly.example.com you@example.com   # secrets + origin
./scripts/deploy.sh                                          # build, migrate, start, verify
```

`DEPLOYMENT.md` has the full AWS runbook (EC2, Elastic IP, DNS, encrypted volume, nightly backups, restore drill) and, before any of that, a way to run the exact production stack locally on ports 8080/8443.

## Teacher accounts

Public registration creates **students only** — teacher accounts are never self-assigned, so there is no in-app "sign up as teacher" button. Create one from the machine that runs the stack:

```powershell
# Writes to the same database the running API uses:
docker compose run --rm api npx tsx prisma/create-teacher.ts "Aarav Mehta" aarav@university.edu "a-long-password"
```

The arguments are name, email and password (12+ characters); the same values can be supplied through the `TEACHER_NAME`, `TEACHER_EMAIL` and `TEACHER_PASSWORD` environment variables. Re-running it for an existing email promotes that account to `TEACHER` and resets its password, which also makes it the admin password-recovery path. The opt-in demo profile instead creates `teacher@attendly.local` using your `DEMO_PASSWORD`.

## Layout

```text
apps/api/src/              Express API, authentication and attendance rules
apps/api/prisma/           PostgreSQL schema, SQL migrations and opt-in demo seed
apps/web/app/              Next.js dashboards and same-origin API proxy
docker-compose.yml         Local stack: database, migration job, API, web, demo profile
docker-compose.prod.yml    Production stack: same apps behind Caddy, own project name
Caddyfile                  TLS, HSTS, HTTP→HTTPS redirect and /healthz
scripts/gen-env.sh         Generates .env.production with fresh secrets
scripts/deploy.sh          Health-gated release with automatic rollback
scripts/rollback.sh        Repoints the stack at an earlier release
scripts/backup.sh          Nightly pg_dump with retention (and optional S3 copy)
scripts/restore.sh         Restore, or rehearse a restore against a scratch database
scripts/ec2-user-data.sh   Cloud-init bootstrap for an AWS EC2 host
docs/api-contract.md       Intended API contract and attendance semantics
```

## Teacher controls

- Create courses and share a generated enrollment join code.
- Manage the roster directly: enroll a student by the email they registered with, or remove a student from a course.
- Roll call by **PRN**: every student list (roster, attendance and analytics) shows the PRN beside the name, is ordered by PRN, and has a search box that matches PRN, name or email.
- **Manual scheduler:** create future-dated lectures, reschedule or delete them, and open any of them as a live session on demand.
- Open a live session for a course (one live session per course at a time; scheduled lectures can pile up freely).
- Mark each student Present, Late, Absent or Excused, or use bulk actions to mark the whole roster at once — during or after a session.
- Close a session to finalize it, or reopen it for corrections.
- **Live analytics:** a per-subject table of every student's present/late/absent/excused counts and attendance rate, lowest performers first.
- **Noticeboard:** publish notices and study-material links (URL-based, no file storage) to a course; pin or delete them.
- Every manual change is written to the audit table with an actor, the previous status, the new status, a timestamp and a reason.
- Export a course's attendance as CSV (columns: Student, PRN, Email, Session, Date, Status).

## Student workspace

Students sign up with a **PRN (Permanent Registration Number)**, which is unique and required at registration. Students who registered before PRN existed can add it at any time from their profile (the pencil button in the sidebar, or the "Add your PRN" prompt on their dashboard).

Every lecture is shown as a time window with its date (for example **9–10 am · 03/10/2026**) for both teachers and students. Students can open any subject to see each individual lecture with a present/late/absent/excused indicator, filter the list by status, and see lectures the teacher has scheduled ahead.

Students join a course with the enrollment code and see read-only analytics: attendance rate, lectures completed (for example **9/12**), current streak, per-course progress rings, a monthly calendar and recent attendance history. Each subject opened from the progress ring adds present/late/absent/excused counts per lecture, so the headline numbers always have the underlying records behind them. They also get a read-only **noticeboard** feed of every notice and study material their teachers publish. Students cannot mark, alter or spoof their own attendance.

## Profile and account menu

The user block at the bottom of the sidebar is the account menu: **View profile** (photo), **Account settings** (display name, email, and PRN for students), **Appearance** (light/dark, remembered per browser) and **Log out**. The dashboard header carries no account avatar, so navigation actions sit flush with the right margin.

Profile photos are uploaded by drag-and-drop or the file browser, cropped in a circular viewport in the browser, and stored inline on the user row as a compressed data URL — there is no object storage or upload volume to run, and the image survives container restarts. Without a photo, every avatar falls back to gradient initials. Student avatars also appear next to their names in the teacher's attendance roster and analytics tables.

## Security model

- Opaque HttpOnly sessions; only token hashes are stored in PostgreSQL.
- bcrypt password hashes, student-only registration, role and teacher ownership checks.
- Signed double-submit CSRF protection plus mutation Origin validation.
- Strict role-based access control: teacher-only routes (scheduling, attendance, analytics, noticeboard authoring) reject students with 403, and every write is ownership-scoped. Students cannot spoof attendance API requests.
- Database uniqueness prevents duplicate attendance; manual overrides are recorded in the audit table.
- Private database/API containers, explicit migration job, non-root application runtimes.

## Credits and ownership

Attendly is created and managed by **Tauheed Khan**, JNEC Aurangabad, who holds the
copyright to its name, source code, schema, interface and documentation. The
attribution is also surfaced in the product itself: on the sign-in screen, in
the dashboard footer, in the **About & credits** panel, and in the page
`<meta>` tags (`author`, `creator`, `publisher`, `copyright`). Contact:
khantauheed759@gmail.com.

## Checks

```powershell
cd apps/api
npm ci
npx prisma generate
npm run build
npm test
cd ../web
npm ci
npm run typecheck
npm run build
```

## Current limitations

This is an implementation baseline, not a production certification. Full Docker/database/browser end-to-end verification still requires a running Docker daemon. Dashboard updates use polling rather than WebSockets. UI controls are currently custom Tailwind/CSS components rather than the requested shadcn component library. Password reset, email verification, MFA, institutional teacher provisioning, distributed rate limiting, pagination and concurrency hardening require follow-up before an institutional rollout. See the implementation and tests rather than treating the original API contract as a guarantee that every planned behavior is complete.
