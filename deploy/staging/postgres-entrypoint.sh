#!/bin/sh
set -eu
mkdir -p /var/lib/postgresql/tls
cp /run/secrets/postgres.crt /var/lib/postgresql/tls/server.crt
cp /run/secrets/postgres.key /var/lib/postgresql/tls/server.key
cp /run/secrets/internal-ca.crt /var/lib/postgresql/tls/ca.crt
chown -R postgres:postgres /var/lib/postgresql/tls
chmod 700 /var/lib/postgresql/tls
chmod 600 /var/lib/postgresql/tls/server.key
# Host checkouts may use umask 077 and a UID other than postgres. The official
# entrypoint drops privileges before reading init scripts; copy this code while
# still root rather than changing the host file or weakening its permissions.
cp /staging/bootstrap.sh /docker-entrypoint-initdb.d/10-shadowbridge.sh
chown postgres:postgres /docker-entrypoint-initdb.d/10-shadowbridge.sh
chmod 600 /docker-entrypoint-initdb.d/10-shadowbridge.sh
# Unix socket administration remains inside this container. Every TCP database
# connection must use TLS and SCRAM; there are no published PostgreSQL ports.
cat > /var/lib/postgresql/tls/pg_hba.conf <<'HBA'
local all all trust
hostssl all all 0.0.0.0/0 scram-sha-256
hostssl all all ::/0 scram-sha-256
hostnossl all all 0.0.0.0/0 reject
hostnossl all all ::/0 reject
HBA
chown postgres:postgres /var/lib/postgresql/tls/pg_hba.conf
chmod 600 /var/lib/postgresql/tls/pg_hba.conf
exec docker-entrypoint.sh "$@" -c hba_file=/var/lib/postgresql/tls/pg_hba.conf
