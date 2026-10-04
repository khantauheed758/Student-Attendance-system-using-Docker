#!/usr/bin/env bash
#
# Point the stack back at an earlier release.
#
#   ./scripts/rollback.sh                 # newest earlier release
#   ./scripts/rollback.sh 20261003-120000 # a specific tag
#   ./scripts/rollback.sh rollback        # the images captured before the last deploy
#
# Nothing is rebuilt: the images from the earlier release still exist locally,
# which is why scripts/deploy.sh keeps the last few of them.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE." >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
HISTORY=.deploy/history
TIMEOUT="${DEPLOY_TIMEOUT:-300}"

read_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
write_env() {
  local tmp
  tmp="$(mktemp)"
  sed "s|^$1=.*$|$1=$2|" "$ENV_FILE" >"$tmp" && mv "$tmp" "$ENV_FILE"
}

CURRENT="$(read_env RELEASE)"
ORIGIN="$(read_env WEB_ORIGIN)"
DOMAIN="$(read_env DOMAIN)"
PROBE=(curl -fsS --max-time 20)
[ "$DOMAIN" = "localhost" ] && PROBE+=(--insecure)
probe() { "${PROBE[@]}" "$ORIGIN$1" >/dev/null 2>&1; }

image_exists() { docker image inspect "attendly/api:$1" >/dev/null 2>&1; }

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # Newest release in the history that is not what we are running right now.
  while read -r candidate; do
    [ "$candidate" = "$CURRENT" ] && continue
    if image_exists "$candidate"; then TARGET="$candidate"; break; fi
  done < <(tac "$HISTORY" 2>/dev/null || true)
fi

if [ -z "$TARGET" ]; then
  if docker image inspect attendly/api:rollback >/dev/null 2>&1; then
    echo "No earlier named release is available; using the images captured before the last deploy."
    TARGET=rollback
  else
    echo "Nothing to roll back to: no earlier attendly/api image is present." >&2
    exit 1
  fi
fi

if ! image_exists "$TARGET"; then
  echo "attendly/api:$TARGET is not on this host. Available tags:" >&2
  docker image ls --format '  {{.Repository}}:{{.Tag}}' attendly/api >&2
  exit 1
fi

echo "▶ Rolling back from '$CURRENT' to '$TARGET'"
write_env RELEASE "$TARGET"
"${COMPOSE[@]}" up -d --no-build

echo "▶ Waiting for $ORIGIN to answer…"
deadline=$((SECONDS + TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  if probe /healthz && probe /api/health; then
    echo "$TARGET" >>"$HISTORY"
    echo "✓ Rolled back to $TARGET; $ORIGIN is serving it again."
    exit 0
  fi
  sleep 5
done

echo "✗ $TARGET did not come up healthy within ${TIMEOUT}s." >&2
echo "  Logs: ${COMPOSE[*]} logs --tail 80 api web caddy" >&2
exit 1
