#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -v auth_password="$SB_AUTH_PASSWORD" -v api_password="$SB_API_PASSWORD" -v session_password="$SB_SESSION_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT;
CREATE ROLE shadowbridge_api LOGIN NOINHERIT;
CREATE ROLE shadowbridge_sessions LOGIN NOINHERIT;
SELECT format('ALTER ROLE supabase_auth_admin PASSWORD %L', :'auth_password') \gexec
SELECT format('ALTER ROLE shadowbridge_api PASSWORD %L', :'api_password') \gexec
SELECT format('ALTER ROLE shadowbridge_sessions PASSWORD %L', :'session_password') \gexec
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
GRANT CREATE ON DATABASE shadowbridge TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth, public;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
