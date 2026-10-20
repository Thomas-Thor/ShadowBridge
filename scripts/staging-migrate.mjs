// Offline installation tool. The running application never receives this DBA URL.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caFile = '/run/secrets/internal-ca.crt';

export async function migrationSources(directory = path.join(root, 'supabase/migrations')) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (names.length < 11) throw new Error('The complete migration history (001–011 or newer) is required.');
  const result = [];
  for (const [index, name] of names.entries()) {
    if (!/^\d{12}_[a-z0-9_]+\.sql$/.test(name) || Number(name.slice(8, 12)) !== index + 1) {
      throw new Error('Migration names must form an uninterrupted, ordered history.');
    }
    const sql = await readFile(path.join(directory, name), 'utf8');
    if (!/^\s*(?:--[^\n]*\n\s*)*BEGIN\s*;/i.test(sql) || !/COMMIT\s*;\s*$/i.test(sql)) {
      throw new Error(`Migration ${name} must use an explicit transaction.`);
    }
    result.push({ name, sql, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  return result;
}

export function migrationConnection(environment = process.env) {
  let url;
  try { url = new URL(environment.DATABASE_ADMIN_URL); } catch { throw new Error('A dedicated DATABASE_ADMIN_URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== 'postgres'
      || decodeURIComponent(url.password).length < 24 || url.hostname !== 'postgres'
      || !['', '5432'].includes(url.port) || url.pathname !== '/shadowbridge'
      || url.searchParams.get('sslmode') !== 'verify-full' || url.searchParams.get('sslrootcert') !== caFile
      || [...url.searchParams.keys()].some(key => !['sslmode', 'sslrootcert'].includes(key))) {
    throw new Error('Migration connection must use the private DBA endpoint and verified TLS.');
  }
  // Supply TLS explicitly: no implicit mode mapping and no verification bypass.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  return { connectionString: url.toString(), application_name: 'shadowbridge-install-migrator',
    connectionTimeoutMillis: 15_000, query_timeout: 120_000 };
}

export function validateApplied(sources, applied) {
  const known = new Map(sources.map(source => [source.name, source.sha256]));
  for (const [index, row] of applied.entries()) {
    if (!known.has(row.name)) throw new Error('Database history is newer or different; do not downgrade this installation.');
    if (known.get(row.name) !== row.sha256) throw new Error(`Applied migration ${row.name} was modified. Restore its original source.`);
    if (row.name !== sources[index]?.name) throw new Error('Database migration history contains a gap; manual investigation is required.');
  }
}

export async function migrate(environment = process.env) {
  // Validate every source and the connection before creating any database object.
  const sources = await migrationSources();
  const connection = migrationConnection(environment);
  const ca = await readFile(caFile, 'utf8');
  const client = new pg.Client({ ...connection, ssl: { ca, rejectUnauthorized: true, servername: 'postgres' } });
  let locked = false;
  try {
    await client.connect();
    const identity = (await client.query("SELECT current_user AS username, current_database() AS database, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS dba, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls")).rows[0];
    if (identity.username !== 'postgres' || identity.database !== 'shadowbridge' || !identity.dba || !identity.tls) {
      throw new Error('A verified TLS DBA connection is required.');
    }
    const authDeadline = Date.now() + 60_000;
    while (!(await client.query("SELECT to_regclass('auth.users') IS NOT NULL AS ready")).rows[0].ready) {
      if (Date.now() >= authDeadline) throw new Error('GoTrue schema is not initialized. Start auth, inspect its private status, then retry migration.');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await client.query("SET lock_timeout='15s'; SET log_statement='none'; SET log_min_error_statement='panic'");
    await client.query("SELECT pg_advisory_lock(hashtext('shadowbridge-local-migrations'))");
    locked = true;
    const existing = (await client.query("SELECT to_regclass('shadowbridge_migrations.applied') IS NOT NULL AS tracked, to_regnamespace('sb') IS NOT NULL AS business_schema")).rows[0];
    if (!existing.tracked && existing.business_schema) throw new Error('Existing business schema has no migration provenance. No changes made; investigate before upgrading.');
    await client.query('CREATE SCHEMA IF NOT EXISTS shadowbridge_migrations; REVOKE ALL ON SCHEMA shadowbridge_migrations FROM PUBLIC; CREATE TABLE IF NOT EXISTS shadowbridge_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON shadowbridge_migrations.applied FROM PUBLIC');
    const applied = (await client.query('SELECT name,sha256 FROM shadowbridge_migrations.applied ORDER BY name')).rows;
    validateApplied(sources, applied);
    let changed = 0;
    for (const source of sources.slice(applied.length)) {
      // Filenames and digest are allowlisted above. Provenance is recorded in
      // the SAME transaction, so interruption cannot mark a partial migration.
      const tracked = source.sql.replace(/COMMIT\s*;\s*$/i, `INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES ('${source.name}','${source.sha256}');\nCOMMIT;\n`);
      try { await client.query(tracked); } catch { await client.query('ROLLBACK').catch(() => {}); throw new Error(`Migration ${source.name} failed and was rolled back. Stop and inspect privately.`); }
      changed++;
      console.log(`Applied ${source.name}`);
    }
    console.log(`Migration check complete: ${sources.length} tracked, ${changed} applied. Existing records were not reset.`);
    return { tracked: sources.length, applied: changed };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('shadowbridge-local-migrations'))").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  migrate().catch(error => {
    // Connection/SQL errors can contain secrets: emit only our own safe errors.
    const safe = error?.constructor === Error && !error.code ? error.message : 'Database migration could not complete. Inspect the private installation locally.';
    console.error(safe);
    process.exitCode = 1;
  });
}
