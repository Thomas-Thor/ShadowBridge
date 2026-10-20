#!/bin/sh
set -eu
# The CLI reads a line: a secret without a trailing newline otherwise yields EOF.
# Keep the plaintext out of process arguments and logs.
SB_TESTER_HASH="$({ cat /run/secrets/tester-password; printf '\n'; } | caddy hash-password --algorithm argon2id)"
export SB_TESTER_HASH
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
