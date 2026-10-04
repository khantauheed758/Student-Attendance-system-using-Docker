#!/usr/bin/env bash
#
# Build and release the production stack on this host.
#
#   ./scripts/deploy.sh                  # release id = UTC timestamp
#   ./scripts/deploy.sh 2026-10-03-a     # or name the release yourself
#
# A release is only declared successful once the public HTTPS endpoints answer,
# so a broken build, a failed migration or an unhealthy container is caught here
# and the previous release is put back automatically.
#
# Use simple release names (letters, digits, dash, underscore): the value is
# written into .env.production.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.production

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE." >&2
  echo "Create one:  ./scripts/gen-env.sh <domain> <email>" >&2
  echo "Or copy:     cp .env.production.example $ENV_FILE" >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
STATE_DIR=.deploy
HISTORY="$STATE_DIR/history"
TIMEOUT="${DEPLOY_TIMEOUT:-300}"

read_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
write_env() {
  local tmp
  tmp="$(mktemp)"
  sed "s|^$1=.*$|$1=$2|" "$ENV_FILE" >"$tmp" && mv "$tmp" "$ENV_FILE"
}

RELEASE="${1:-$(date -u +%Y%m%d-%H%M%S)}"
PREVIOUS_TAG="$(read_env RELEASE)"
ORIGIN="$(read_env WEB_ORIGIN)"
DOMAIN="$(read_env DOMAIN)"
mkdir -p "$STATE_DIR"

if [ -z "$ORIGIN" ]; then
  echo "WEB_ORIGIN is empty in $ENV_FILE. Run ./scripts/gen-env.sh to create a complete file." >&2
  exit 1
fi

# Verify TLS in production. The documented local smoke test uses Caddy's internal
# CA for localhost, which no public trust store knows about.
PROBE=(curl -fsS --max-time 20)
[ "$DOMAIN" = "localhost" ] && PROBE+=(--insecure)
probe() { "${PROBE[@]}" "$ORIGIN$1" >/dev/null 2>&1; }

echo "▶ Releasing attendly-prod '$RELEASE' to $ORIGIN"

# --- keep a way back: tag the images that are serving right now -------------
ROLLBACK_AVAILABLE=0
capture_rollback_target() {
  local api_id web_id
  api_id="$("${COMPOSE[@]}" images -q api 2>/dev/null | head -1 || true)"
  web_id="$("${COMPOSE[@]}" images -q web 2>/dev/null | head -1 || true)"
  [ -n "$api_id" ] && [ -n "$web_id" ] || return 1
  docker tag "$api_id" attendly/api:rollback >/dev/null 2>&1 || return 1
  docker tag "$web_id" attendly/web:rollback >/dev/null 2>&1 || return 1
  return 0
}
if capture_rollback_target; then
  ROLLBACK_AVAILABLE=1
  echo "→ Current images saved as tags 'rollback'"
else
  echo "→ First release on this host: nothing to roll back to yet"
fi

wait_for_release() {
  local deadline=$((SECONDS + TIMEOUT)) started=$SECONDS crashed migrated
  local state_fmt='{{.Service}} {{.State}}'
  while [ "$SECONDS" -lt "$deadline" ]; do
    migrated="$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.ExitCode}}' 2>/dev/null | awk '$1=="migrate"{print $2}' | head -1)"
    if [ -n "$migrated" ] && [ "$migrated" != "0" ]; then
      echo "✗ Database migration failed (exit $migrated)." >&2
      echo "  Inspect it: ${COMPOSE[*]} logs migrate" >&2
      return 1
    fi
    # A container that has already died will not come back on its own.
    crashed="$("${COMPOSE[@]}" ps -a --format "$state_fmt" 2>/dev/null \
      | awk '$1!="migrate" && ($2=="exited" || $2=="dead") {print $1" ("$2")"}' | head -3)"
    if [ -n "$crashed" ]; then
      echo "✗ Container stopped during startup: $crashed" >&2
      return 1
    fi
    # A container that keeps restarting is a crash loop, but a slow first boot
    # looks the same for a few seconds, so only fail after a short grace period.
    if [ $((SECONDS - started)) -gt 45 ]; then
      crashed="$("${COMPOSE[@]}" ps -a --format "$state_fmt" 2>/dev/null \
        | awk '$1!="migrate" && $2=="restarting" {print $1}' | head -3)"
      if [ -n "$crashed" ]; then
        echo "✗ Container is crash-looping: $crashed" >&2
        return 1
      fi
    fi
    if probe /healthz && probe /api/health; then
      return 0
    fi
    sleep 5
  done
  echo "✗ $ORIGIN did not answer within ${TIMEOUT}s." >&2
  return 1
}

rollback_or_die() {
  echo "✗ $1" >&2
  echo "  Logs: ${COMPOSE[*]} logs --tail 80 api web caddy" >&2
  if [ "$ROLLBACK_AVAILABLE" = 1 ]; then
    echo "→ Restoring the previous release…"
    write_env RELEASE rollback
    if "${COMPOSE[@]}" up -d --no-build >/dev/null 2>&1 && wait_for_release; then
      echo "✓ Rolled back: the previous release is serving again at $ORIGIN"
    else
      echo "✗ The rollback did not come up healthy either. The stack needs attention." >&2
      echo "  ${COMPOSE[*]} ps -a && ${COMPOSE[*]} logs --tail 80" >&2
    fi
  else
    write_env RELEASE "$PREVIOUS_TAG"
    echo "→ Nothing to roll back to; the stack was never serving a release." >&2
  fi
  exit 1
}

write_env RELEASE "$RELEASE"

echo "▶ Building api and web ($RELEASE)…"
if ! "${COMPOSE[@]}" build api web; then
  write_env RELEASE "$PREVIOUS_TAG"
  echo "✗ Build failed. The running stack was not touched (RELEASE restored to $PREVIOUS_TAG)." >&2
  exit 1
fi

echo "▶ Starting db, migrations, api, web and caddy…"
if ! "${COMPOSE[@]}" up -d; then
  rollback_or_die "the stack failed to start"
fi

echo "▶ Waiting for $ORIGIN to answer (up to ${TIMEOUT}s)…"
if ! wait_for_release; then
  rollback_or_die "the new release did not pass its health checks"
fi

echo "$RELEASE" >>"$HISTORY"

# Keep the current release, the rollback tag and the three newest releases;
# drop everything else so a small disk never fills with old images.
prune_old_images() {
  local keep tag
  keep="|$(read_env RELEASE)|rollback|$(tail -n 3 "$HISTORY" 2>/dev/null | tr '\n' '|')"
  for repo in attendly/api attendly/web; do
    while read -r tag; do
      [ -n "$tag" ] && [ "$tag" != "<none>" ] || continue
      case "$keep" in *"|$tag|"*) continue ;; esac
      docker rmi "$repo:$tag" >/dev/null 2>&1 || true
    done < <(docker image ls --format '{{.Tag}}' "$repo" 2>/dev/null)
  done
}
prune_old_images

echo
"${COMPOSE[@]}" ps
echo
echo "✓ Release $RELEASE is live at $ORIGIN"
echo "  Roll back with: ./scripts/rollback.sh"
