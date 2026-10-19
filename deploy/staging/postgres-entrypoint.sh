#!/bin/sh
set -eu
mkdir -p /var/lib/postgresql/tls
cp /run/secrets/postgres.crt /var/lib/postgresql/tls/server.crt
cp /run/secrets/postgres.key /var/lib/postgresql/tls/server.key
cp /run/secrets/internal-ca.crt /var/lib/postgresql/tls/ca.crt
chown -R postgres:postgres /var/lib/postgresql/tls
chmod 700 /var/lib/postgresql/tls
chmod 600 /var/lib/postgresql/tls/server.key
exec docker-entrypoint.sh "$@"
