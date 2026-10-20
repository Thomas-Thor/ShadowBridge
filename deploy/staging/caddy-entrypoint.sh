#!/bin/sh
set -eu
# The CLI reads a line: a secret without a trailing newline otherwise yields EOF.
# Keep the plaintext out of process arguments and logs.
# bcrypt also matches existing generated Caddyfiles whose basic_auth directive
# omits its algorithm. Do not regenerate their passwords or private config.
SB_TESTER_HASH="$({ cat /run/secrets/tester-password; printf '\n'; } | caddy hash-password --algorithm bcrypt)"
export SB_TESTER_HASH
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
