#!/usr/bin/env bash
#
# Cloud-init user-data for a single EC2 host that runs the production stack.
#
# Pass it when creating the instance:
#   --user-data file://scripts/ec2-user-data.sh
#
# It installs Docker Engine + Compose, adds a 2 GB swap file (the Next.js
# production build needs more memory than a 2 GB instance has free), enables
# unattended security updates and caps journald growth. The application itself is
# deployed afterwards with scripts/deploy.sh — see DEPLOYMENT.md.
#
# Works on Ubuntu LTS (apt) and Amazon Linux 2023 (dnf).
set -euxo pipefail

ADMIN_USER="${ADMIN_USER:-ubuntu}"
id "$ADMIN_USER" >/dev/null 2>&1 || ADMIN_USER=ec2-user

# --- packages -----------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends ca-certificates curl gnupg git unzip unattended-upgrades
  dpkg-reconfigure -f noninteractive unattended-upgrades || true
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl git unzip dnf-automatic
  systemctl enable --now dnf-automatic.timer || true
fi

# --- Docker Engine + Compose plugin (official convenience script) -------------
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi
systemctl enable --now docker
usermod -aG docker "$ADMIN_USER" || true

# --- 2 GB swap: keeps the image build from being OOM-killed -------------------
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >>/etc/sysctl.conf

# --- keep logs from filling the volume ---------------------------------------
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi
mkdir -p /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/attendly.conf <<'CONF'
[Journal]
SystemMaxUse=200M
CONF
systemctl restart systemd-journald || true

# --- application directory ----------------------------------------------------
install -d -o "$ADMIN_USER" -g "$ADMIN_USER" /srv/attendly

# --- daily database backup ----------------------------------------------------
cat >/etc/cron.d/attendly-backup <<CRON
# Nightly PostgreSQL dump into /srv/attendly/backups (keeps the newest 14).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * $ADMIN_USER cd /srv/attendly && ./scripts/backup.sh >> /var/log/attendly-backup.log 2>&1
CRON
chmod 0644 /etc/cron.d/attendly-backup

echo "user-data finished: Docker $(docker --version), Compose $(docker compose version --short || true)"
