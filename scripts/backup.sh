#!/usr/bin/env bash
#
# Dump the production database into backups/ and prune old dumps.
#
#   ./scripts/backup.sh
#   BACKUP_S3_BUCKET=my-bucket ./scripts/backup.sh   # also upload (needs aws CLI)
#   BACKUP_KEEP=30 ./scripts/backup.sh               # keep 30 dumps instead of 14
#
# The dump is written with --clean --if-exists so scripts/restore.sh can replace
# the current tables in one pass.
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP="${BACKUP_KEEP:-14}"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE." >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
read_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
DB_USER="$(read_env POSTGRES_USER)"
DB_NAME="$(read_env POSTGRES_DB)"

mkdir -p backups
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="backups/attendly-$STAMP.sql.gz"

# pipefail makes a failing pg_dump fail the whole pipeline, so a broken
# connection can never leave a truncated file behind as "the backup".
"${COMPOSE[@]}" exec -T db pg_dump --clean --if-exists -U "$DB_USER" -d "$DB_NAME" | gzip >"$FILE"

if ! gzip -t "$FILE" 2>/dev/null; then
  rm -f "$FILE"
  echo "✗ The dump is corrupt and was removed. Nothing usable was written." >&2
  exit 1
fi
if [ ! -s "$FILE" ]; then
  rm -f "$FILE"
  echo "✗ The dump is empty and was removed." >&2
  exit 1
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ $FILE ($SIZE)"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$FILE" "s3://$BACKUP_S3_BUCKET/$(basename "$FILE")" --only-show-errors
    echo "✓ Copied to s3://$BACKUP_S3_BUCKET/"
  else
    echo "! BACKUP_S3_BUCKET is set but the aws CLI is missing; the local copy is the only one." >&2
  fi
fi

# Prune, newest first. `.gz` only, so a manual dump is never deleted.
if command -v xargs >/dev/null 2>&1; then
  ls -1t backups/attendly-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
else
  ls -1t backups/attendly-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
fi
echo "  Kept the $KEEP newest dumps in backups/"
