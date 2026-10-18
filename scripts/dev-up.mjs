import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { ensureEnvironment, localEnvironment, root, envFile } from './dev-env.mjs';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

await ensureEnvironment();
const environment = await localEnvironment();
await run('docker', ['compose', '--env-file', envFile, '-f', 'local/compose.yaml', 'up', '-d', '--wait', '--wait-timeout', '120'], { env: environment });
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try { const response = await fetch('http://127.0.0.1:9999/health'); if (response.ok) { ready = true; break; } } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('Local GoTrue did not become healthy. Inspect docker compose logs locally; do not publish logs containing private data.');
const admin = new pg.Client({ connectionString: environment.DATABASE_ADMIN_URL });
try {
  await admin.connect();
  await admin.query("SELECT pg_advisory_lock(hashtext('shadowbridge-local-migrations'))");
  await admin.query('CREATE SCHEMA IF NOT EXISTS shadowbridge_migrations; REVOKE ALL ON SCHEMA shadowbridge_migrations FROM PUBLIC; CREATE TABLE IF NOT EXISTS shadowbridge_migrations.applied (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON shadowbridge_migrations.applied FROM PUBLIC');
  const directory = path.join(root, 'supabase/migrations');
  const migrations = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const sql = await readFile(path.join(directory, name), 'utf8');
    const digest = createHash('sha256').update(sql).digest('hex');
    const { rows } = await admin.query('SELECT sha256 FROM shadowbridge_migrations.applied WHERE name=$1', [name]);
    if (rows[0] && rows[0].sha256 !== digest) throw new Error(`Already applied migration ${name} changed. Create a new migration; never silently rewrite database history.`);
    if (!rows[0]) {
      if (!/^\s*(?:--[^\n]*\n\s*)*BEGIN\s*;/i.test(sql) || !/COMMIT\s*;\s*$/i.test(sql)) throw new Error(`Migration ${name} must be wrapped in BEGIN/COMMIT`);
      // The allowlisted filename and hex digest contain no SQL metacharacters.
      // Record provenance in the SAME transaction as the schema change so a
      // process interruption cannot leave a successful migration unrecorded.
      const tracked = sql.replace(/COMMIT\s*;\s*$/i, `INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES ('${name}','${digest}');\nCOMMIT;\n`);
      await admin.query(tracked);
      console.log(`Applied ${name}`);
    }
  }
} finally { await admin.end(); }
console.log('Local database, GoTrue Auth and Mailpit are ready. SMTP is captured locally at http://127.0.0.1:8025; no real email is sent.');
console.log('Start the application with the dev:server command documented in package.json. Secrets remain in ignored .local/development.env.');
