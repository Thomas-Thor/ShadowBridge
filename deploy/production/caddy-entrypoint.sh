#!/bin/sh
set -eu
# This separate edge token is never a session, JWT, database or user secret.
# Read it from the mounted private file, never an argument or console prompt.
SB_PROXY_TOKEN="$(cat /run/secrets/proxy-token)"
case "$SB_PROXY_TOKEN" in
  *[!a-f0-9]*|'') exit 1 ;;
esac
[ "${#SB_PROXY_TOKEN}" -eq 64 ] || exit 1
export SB_PROXY_TOKEN
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
