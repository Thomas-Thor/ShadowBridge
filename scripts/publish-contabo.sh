#!/usr/bin/env bash
# Publish the existing ShadowBridge application at shadow-bridge.eu.
# Never destroys database volumes, users, existing MFA, or encryption secrets.
set -Eeuo pipefail
umask 077
ROOT=/opt/shadowbridge
PRIVATE=$ROOT/.local/contabo-private
PUBLIC=/opt/shadowbridge-public
BASE=$ROOT/deploy/staging/compose.yaml
SOURCE=$PUBLIC/compose.yaml
STAGE_OVERRIDE=$PRIVATE/public-origin.override.yaml
PUBLIC_OVERRIDE=$PUBLIC/compose.shadowbridge.yaml
PROXY_CONFIG=$PRIVATE/internal-auth-proxy.Caddyfile
BACKUP_CADDY=$PUBLIC/Caddyfile.before-shadowbridge
DOMAIN=shadow-bridge.eu
started=0
published=0
stage() { docker compose -p "$PROJECT" --env-file "$PRIVATE/compose.env" -f "$BASE" -f "$STAGE_OVERRIDE" "$@"; }
oldstage() { docker compose -p "$PROJECT" --env-file "$PRIVATE/compose.env" -f "$BASE" "$@"; }
web() { docker compose -f "$SOURCE" -f "$PUBLIC_OVERRIDE" "$@"; }
rollback() {
  code=$?
  trap - ERR
  echo "STOP: Public rollout failed (exit $code); database and accounts were NOT deleted." >&2
  if [ "$published" = 1 ] && [ -s "$BACKUP_CADDY" ]; then
    cat "$BACKUP_CADDY" > "$PUBLIC/Caddyfile"
    docker exec "$(web ps -q web)" caddy reload --config /etc/caddy/Caddyfile || true
    echo 'Previous public Caddy configuration restored.' >&2
  fi
  if [ "$started" = 1 ]; then oldstage up -d --no-deps auth app gateway || true; fi
  exit "$code"
}
trap rollback ERR
if [ "$(id -u)" != 0 ]; then echo 'STOP: run through sudo.' >&2; exit 1; fi
cd "$ROOT"
for f in "$PRIVATE/manifest.json" "$PRIVATE/compose.env" "$SOURCE" "$PUBLIC/Caddyfile"; do
  [ -f "$f" ] || { echo "STOP: installation file missing: $f" >&2; exit 1; }
done
PROJECT="$(node -e "const f=require('fs');process.stdout.write(JSON.parse(f.readFileSync('$PRIVATE/manifest.json')).project)")"
[ "$PROJECT" = shadowbridge-contabo-fd2c221897 ] || { echo 'STOP: unexpected Docker project.' >&2; exit 1; }
[ "$(git branch --show-current)" = feature/secure-b2b-mvp ] || { echo 'STOP: wrong Git branch.' >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'STOP: repository contains uncommitted changes.' >&2; exit 1; }
node scripts/staging-prepare.mjs --check --dir="$PRIVATE"
oldstage ps --status running --services | grep -qx postgres
docker compose -f "$SOURCE" ps --status running --services | grep -qx web
curl --noproxy '*' --fail --silent --show-error --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" >/dev/null

echo '1/5 — New encrypted backup before any changes.'
node scripts/staging-ops.mjs backup --dir="$PRIVATE"
docker network inspect shadowbridge-edge >/dev/null 2>&1 || docker network create --internal shadowbridge-edge >/dev/null

cat > "$PROXY_CONFIG" <<'CADDY'
{
    admin off
}
https://auth-proxy:8444 {
    tls /run/secrets/auth-proxy.crt /run/secrets/auth-proxy.key
    handle_path /auth/v1/* {
        reverse_proxy auth:9999
    }
    respond 404
}
CADDY

cat > "$STAGE_OVERRIDE" <<YAML
services:
  app:
    environment:
      APP_URL: https://shadow-bridge.eu
    networks:
      - private
      - edge
  auth:
    environment:
      API_EXTERNAL_URL: https://shadow-bridge.eu
      GOTRUE_SITE_URL: https://shadow-bridge.eu
      GOTRUE_URI_ALLOW_LIST: https://shadow-bridge.eu/auth/confirm,https://shadow-bridge.eu/auth/recover
  gateway:
    ports: !reset []
    volumes:
      - $PROXY_CONFIG:/etc/caddy/Caddyfile:ro
networks:
  edge:
    name: shadowbridge-edge
    external: true
YAML

cat > "$PUBLIC_OVERRIDE" <<'YAML'
services:
  web:
    networks:
      - default
      - edge
networks:
  edge:
    name: shadowbridge-edge
    external: true
YAML
stage config --quiet
web config --quiet

echo '2/5 — Switching application origin, keeping all users and database volumes.'
started=1
stage up -d --wait --wait-timeout 180 auth gateway app
web up -d --no-deps web
WEB_ID="$(web ps -q web)"
[ -n "$WEB_ID" ]
echo '3/5 — Checking private API and sign-in page.'
docker exec "$WEB_ID" wget -q -O /dev/null http://app:8088/member-sign-in/
docker exec "$WEB_ID" wget -q -O - http://app:8088/api/config | grep -q '"backendEnabled":true'

cp "$PUBLIC/Caddyfile" "$BACKUP_CADDY"
cat > "$PUBLIC/Caddyfile" <<'CADDY'
{
    admin off
}
www.shadow-bridge.eu {
    redir https://shadow-bridge.eu{uri} permanent
}
shadow-bridge.eu {
    encode gzip
    reverse_proxy app:8088
    header -Server
}
CADDY
published=1
docker exec "$WEB_ID" caddy validate --config /etc/caddy/Caddyfile
docker exec "$WEB_ID" caddy reload --config /etc/caddy/Caddyfile

echo '4/5 — Checking public domain, registration pages and live backend.'
for route in / /member-sign-in/ /apply/buyer/ /apply/supplier/ /apply/partner/ /api/config; do
  curl --noproxy '*' --fail --silent --show-error --max-time 20 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN$route" >/dev/null
done
curl --noproxy '*' --fail --silent --show-error --max-time 20 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/config" | grep -q '"backendEnabled":true'
published=0
started=0
trap - ERR
echo '5/5 — SHADOWBRIDGE APPLICATION AVAILABLE ON https://shadow-bridge.eu'
echo 'Existing user accounts, MFA, PostgreSQL data and encryption keys preserved.'
echo 'Legacy backups and volumes retained until a separate verified cleanup.'
