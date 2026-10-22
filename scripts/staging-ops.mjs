// Host-side operator commands. No SSH, DNS, public listener or demo bootstrap.
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, writeFile, lstat, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging, readEnv, repositoryRoot } from './staging-prepare.mjs';
import { migrationSources } from './staging-migrate.mjs';
import { backupStaging, decryptBackup, restoreConfiguration } from './staging-backup.mjs';
import { archiveHasVault, privateArchiveCatalog, restoredVaultRolesSql } from './vault-recovery-roles.mjs';

export function composeArguments(directory, args) {
  const project = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')).project;
  if (!/^shadowbridge-(?:contabo|stageg)-[a-z0-9-]+$/.test(project)) throw new Error('Invalid private project identity.');
  return ['--context', 'default', 'compose', '--project-name', project, '--env-file', path.join(directory, 'compose.env'), '-f', path.join(repositoryRoot, 'deploy/staging/compose.yaml'), ...args];
}
export async function compose(directory, args, { capture = false } = {}) {
  const environment = { ...process.env, ...await readEnv(path.join(directory, 'compose.env')) };
  if (capture) {
    try { return execFileSync('docker', composeArguments(directory, args), { cwd: repositoryRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { throw new Error('Private container command failed. Inspect the installation locally; do not publish raw logs.'); }
  }
  await new Promise((resolve, reject) => {
    const child = spawn('docker', composeArguments(directory, args), { cwd: repositoryRoot, env: environment, stdio: 'inherit' });
    child.once('error', () => reject(new Error('Docker Compose is unavailable.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Container operation stopped; no volumes were removed.')));
  });
}
async function initialized(directory) {
  return (await compose(directory, ['exec', '-T', 'postgres', 'psql', '-XAtq', '-U', 'postgres', '-d', 'shadowbridge', '-c', "SELECT CASE WHEN to_regclass('shadowbridge_migrations.applied') IS NULL THEN 0 ELSE 1 END"], { capture: true })) === '1';
}

// pg_dump deliberately excludes cluster-wide roles. Recovery below is accepted
// only after an authenticated backup has been restored into a separately
// guarded, previously empty project. Do not add this to startup or migrations:
// 015 must retain its fail-closed collision guard on ordinary installations.
export const restoredSentinelRoleSql = `DO $sentinel_recovery$
DECLARE reserved pg_catalog.pg_authid;
BEGIN
 IF current_user<>'postgres' OR current_database()<>'shadowbridge' THEN
  RAISE EXCEPTION 'Reserved role recovery requires the isolated recovery DBA' USING ERRCODE='42501';
 END IF;
 IF to_regclass('shadowbridge_migrations.applied') IS NULL THEN
  RAISE EXCEPTION 'Recovered database has no migration provenance' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM shadowbridge_migrations.applied
  WHERE name='202610210015_sentinel_verification.sql') THEN RETURN; END IF;
 SELECT * INTO reserved FROM pg_catalog.pg_authid WHERE rolname='shadowbridge_sentinel';
 IF FOUND THEN
  IF reserved.rolcanlogin OR reserved.rolinherit OR reserved.rolsuper
   OR reserved.rolbypassrls OR reserved.rolcreatedb OR reserved.rolcreaterole
   OR reserved.rolreplication OR reserved.rolconnlimit<>-1
   OR reserved.rolpassword IS NOT NULL
   OR reserved.rolvaliduntil IS NOT NULL
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=reserved.oid)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid=reserved.oid OR member=reserved.oid)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend
    WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=reserved.oid) THEN
   RAISE EXCEPTION 'Existing reserved recovery role requires administrative review' USING ERRCODE='42501';
  END IF;
  RETURN;
 END IF;
 CREATE ROLE shadowbridge_sentinel NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION;
END $sentinel_recovery$;`;

async function recoverRestoredSentinelRole(directory) {
  await compose(directory, ['exec', '-T', 'postgres', 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'shadowbridge', '-c', restoredSentinelRoleSql], { capture: true });
}
export async function backupInstallation(directory) {
  const checked = await checkStaging({ directory });
  const running = (await compose(directory, ['ps', '--services', '--status', 'running'], { capture: true })).split('\n');
  const paused = ['app', 'auth'].filter(service => running.includes(service));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const folder = path.join(checked.directory, 'backups');
  try { await mkdir(folder, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const folderInfo = await lstat(folder);
  if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink() || (folderInfo.mode & 0o777) !== 0o700) throw new Error('Backup directory must be a private regular directory with mode 0700.');
  const backupFile = path.join(folder, stamp + '.sbb');
  const keyFile = path.join(folder, stamp + '.key');
  if (paused.length) await compose(directory, ['stop', ...paused]);
  try {
    await backupStaging({ directory, backupFile, keyFile });
    console.log('Encrypted database + configuration backup created. Keep the recovery key separately and offline.');
    console.log(`Backup: ${backupFile}\nRecovery key file: ${keyFile}`);
    return { backupFile, keyFile };
  } finally { if (paused.length) await compose(directory, ['start', ...paused]); }
}
export async function restoreInstallation({ directory, project, httpsPort, backupFile, keyFile }) {
  if (!directory || !project || !backupFile || !keyFile) throw new Error('Restore requires a new --dir, --project, --backup and --key.');
  const extraction = path.join(repositoryRoot, '.local', `restore-${randomBytes(8).toString('hex')}`);
  const recovered = await decryptBackup({ backupFile, keyFile, destination: extraction });
  const checked = await restoreConfiguration({ restoredDirectory: extraction, directory, project, httpsPort });
  directory = checked.directory;
  await compose(directory, ['config', '--quiet']);
  await compose(directory, ['build', 'app', 'migrator']);
  await compose(directory, ['up', '-d', '--wait', '--wait-timeout', '120', 'postgres']);
  const empty = await compose(directory, ['exec', '-T', 'postgres', 'psql', '-XAtq', '-U', 'postgres', '-d', 'shadowbridge', '-c', "SELECT to_regclass('auth.users') IS NULL AND to_regnamespace('sb') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='auth')"], { capture: true });
  if (empty !== 't') throw new Error('Restore target is not an empty, new installation. Nothing was restored.');
  // --clean affects only the bootstrap-created empty schemas in this new,
  // independently guarded project. It is never accepted against an existing DB.
  const restoreEnvironment = { ...process.env, ...await readEnv(path.join(directory, 'compose.env')) };
  // pg_dump excludes cluster roles, but function ownership/ACLs need these
  // reserved NOLOGIN principals before pg_restore. Older archives must NOT
  // receive them: migration 016 deliberately rejects pre-existing principals.
  const catalog=await privateArchiveCatalog({args:composeArguments(directory,['exec','-T','postgres','pg_restore','--list']),environment:restoreEnvironment,cwd:repositoryRoot,dumpFile:recovered.databaseDump});
  if(archiveHasVault(catalog))await compose(directory,['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',restoredVaultRolesSql],{capture:true});
  await new Promise((resolve, reject) => {
    const child = spawn('docker', composeArguments(directory, ['exec', '-T', 'postgres', 'pg_restore', '--clean', '--if-exists', '--exit-on-error', '-U', 'postgres', '-d', 'shadowbridge']), { cwd: repositoryRoot, env: restoreEnvironment, stdio: ['pipe', 'ignore', 'pipe'] });
    const input = createReadStream(recovered.databaseDump);
    input.on('error', () => { child.kill(); reject(new Error('Private recovery dump could not be read.')); });
    child.stdin.on('error', () => {});
    child.stderr.resume(); // SQL errors can contain confidential text: never log.
    input.pipe(child.stdin);
    child.once('error', () => { input.destroy(); reject(new Error('Recovery container could not be started.')); });
    child.once('exit', code => { input.destroy(); code === 0 ? resolve() : reject(new Error('Restore failed. Source untouched; new private target retained for inspection.')); });
  });
  await recoverRestoredSentinelRole(directory);
  await operate({ action: 'start', directory });
  await rm(extraction, { recursive: true, force: true });
  console.log('Recovery completed in a NEW private project. Source installation and backups were not changed.');
  return checked;
}
export async function operate({ action, directory, email, grantOwner = false, project, httpsPort, backupFile, keyFile } = {}) {
  if (action === 'restore') return restoreInstallation({ directory, project, httpsPort, backupFile, keyFile });
  const checked = await checkStaging({ directory });
  directory = checked.directory;
  await compose(directory, ['config', '--quiet']);
  if (action === 'status') return compose(directory, ['ps']);
  if (action === 'stop') return compose(directory, ['stop']);
  if (action === 'backup') return backupInstallation(directory);
  if (action === 'build') return compose(directory, ['build', 'app', 'migrator']);
  if (action === 'owner') {
    if (!grantOwner || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('OWNER bootstrap requires a verified account email and explicit --grant-owner.');
    return compose(directory, ['run', '--rm', '--no-deps', 'migrator', 'node', 'scripts/bootstrap-admin.mjs', `--email=${email}`, '--grant-owner']);
  }
  if (action === 'restart') return compose(directory, ['restart', 'postgres', 'mailpit', 'auth', 'app', 'gateway']);
  if (!['start', 'update'].includes(action)) throw new Error('Use build, start, status, stop, restart, backup, update, restore or owner.');
  if (action === 'update') {
    // Must already be operational. Backup happens BEFORE rebuilding/replacing images.
    await backupInstallation(directory);
    const images = await compose(directory, ['images', '--format', 'json'], { capture: true });
    await writeFile(path.join(directory, 'previous-images.json'), images + '\n', { mode: 0o600 });
  }
  await compose(directory, ['build', 'app', 'migrator']);
  await compose(directory, ['up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'mailpit', 'auth']);
  if (action === 'start' && await initialized(directory)) {
    const applied = Number(await compose(directory, ['exec', '-T', 'postgres', 'psql', '-XAtq', '-U', 'postgres', '-d', 'shadowbridge', '-c', 'SELECT count(*) FROM shadowbridge_migrations.applied'], { capture: true }));
    if (applied !== (await migrationSources()).length) throw new Error('An existing installation needs migrations. Use update, which creates a backup first.');
  }
  // No business writes can race schema updates. No data volume is deleted.
  await compose(directory, ['stop', 'app']);
  await compose(directory, ['run', '--rm', '--no-deps', 'migrator']);
  await compose(directory, ['up', '-d', '--wait', '--wait-timeout', '120', 'app', 'gateway']);
  console.log(`Private installation ready at ${checked.origin}, accessible only on loopback/SSH tunnel. Email remains captured in Mailpit.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const action = args.shift();
  const options = { action };
  for (const arg of args) {
    if (arg === '--grant-owner') options.grantOwner = true;
    else if (arg.startsWith('--dir=')) options.directory = arg.slice(6);
    else if (arg.startsWith('--email=')) options.email = arg.slice(8);
    else if (arg.startsWith('--project=')) options.project = arg.slice(10);
    else if (arg.startsWith('--https-port=')) options.httpsPort = arg.slice(13);
    else if (arg.startsWith('--backup=')) options.backupFile = arg.slice(9);
    else if (arg.startsWith('--key=')) options.keyFile = arg.slice(6);
    else { console.error('Unknown private installation option.'); process.exit(1); }
  }
  operate(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
