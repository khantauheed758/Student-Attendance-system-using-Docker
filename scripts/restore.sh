#!/usr/bin/env bash
#
# Restore a dump produced by scripts/backup.sh.
#
#   ./scripts/restore.sh backups/attendly-20261003-120000.sql.gz
#   ./scripts/restore.sh --yes backups/attendly-20261003-120000.sql.gz
#   ./scripts/restore.sh --target attendly_drill --yes backups/...   # safety drill
#
# The API is stopped first so nothing writes while tables are replaced, then the
# stack is brought back up and health-checked.
#
# Practise this. A backup you have never restored is a guess.
set -euo pipefail
cd "$(dirname "$0")/.."

ASSUME_YES=0
TARGET_DB=""
FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
  --yes | -y) ASSUME_YES=1 ;;
  --target) shift; TARGET_DB="${1:-}" ;;
  -*) echo "Unknown option: $1" >&2; exit 1 ;;
  *) FILE="$1" ;;
  esac
  shift
done

ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE." >&2; exit 1; }
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: $0 [--yes] [--target <db>] backups/attendly-<stamp>.sql.gz" >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
read_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
DB_USER="$(read_env POSTGRES_USER)"
DB_NAME="${TARGET_DB:-$(read_env POSTGRES_DB)}"
ORIGIN="$(read_env WEB_ORIGIN)"
DOMAIN="$(read_env DOMAIN)"
PROBE=(curl -fsS --max-time 20)
[ "$DOMAIN" = "localhost" ] && PROBE+=(--insecure)

if [ -z "$TARGET_DB" ]; then
  echo "About to replace every table in '$DB_NAME' from:"
  echo "  $FILE"
  if [ "$ASSUME_YES" != 1 ]; then
    if [ ! -t 0 ]; then
      echo "Not a terminal: pass --yes to confirm." >&2
      exit 1
    fi
    read -r -p "Type the database name ($DB_NAME) to continue: " ANSWER
    [ "$ANSWER" = "$DB_NAME" ] || { echo "Aborted."; exit 1; }
  fi
else
  # Drill mode: restore into a separate database, leaving production untouched.
  echo "Restoring $FILE into the scratch database '$DB_NAME'"
  "${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 ||
    "${COMPOSE[@]}" exec -T db createdb -U "$DB_USER" "$DB_NAME"
fi

if [ -z "$TARGET_DB" ]; then
  echo "▶ Stopping the API so nothing writes during the restore…"
  "${COMPOSE[@]}" stop api >/dev/null
fi

echo "▶ Loading $FILE…"
if ! gunzip -c "$FILE" | "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -q -o /dev/null -U "$DB_USER" -d "$DB_NAME"; then
  echo "✗ Restore failed. The API is left stopped on purpose: inspect the output above," >&2
  echo "  fix the cause, then run: ${COMPOSE[*]} up -d" >&2
  exit 1
fi
echo "✓ Data loaded into $DB_NAME"

if [ -n "$TARGET_DB" ]; then
  echo "  Drill finished. Drop it with:"
  echo "  ${COMPOSE[*]} exec db dropdb -U $DB_USER $DB_NAME"
  exit 0
fi

echo "▶ Starting the stack again…"
"${COMPOSE[@]}" up -d --no-build

deadline=$((SECONDS + 300))
while [ "$SECONDS" -lt "$deadline" ]; do
  if "${PROBE[@]}" "$ORIGIN/api/health" >/dev/null 2>&1; then
    echo "✓ Restored and healthy at $ORIGIN"
    exit 0
  fi
  sleep 5
done
echo "✗ The API did not become healthy after the restore." >&2
echo "  Logs: ${COMPOSE[*]} logs --tail 80 api" >&2
exit 1
