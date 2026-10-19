#!/bin/sh
set -eu
SB_TESTER_HASH="$(caddy hash-password --algorithm argon2id < /run/secrets/tester-password)"
export SB_TESTER_HASH
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
