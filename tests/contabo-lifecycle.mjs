// Operator-run REAL Docker/PostgreSQL/Auth recovery regression. This refuses
// the owner's local project and never removes a volume or resets a source DB.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { migrationSources } from '../scripts/staging-migrate.mjs';
import { compose, operate, backupInstallation, restoreInstallation } from '../scripts/staging-ops.mjs';
import { totp } from '../server/tests/helpers.mjs';

const directory = path.join(repositoryRoot, '.local/contabo-g3-regression');
const reportFile = '/tmp/shadowbridge-contabo-lifecycle.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const results = [];
let current = 'guarded test initialization';
let restored;
function pass(name) { results.push({ name, status: 'PASS' }); console.log(`PASS ${results.length}: ${name}`); }
function requireSame(actual, expected, message) {
  // Native deep-equality failures would print password/MFA hashes or private rows.
  assert.ok(JSON.stringify(actual) === JSON.stringify(expected), message);
}
async function sql(dir, query) {
  return compose(dir, ['exec', '-T', 'postgres', 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'shadowbridge', '-c', query], { capture: true });
}
async function snapshot(dir) {
  const business = JSON.parse(await sql(dir, `
    CREATE TEMP TABLE lifecycle_snapshot(name text PRIMARY KEY,fingerprint text);
    DO $snapshot$ DECLARE item record; BEGIN
      FOR item IN SELECT schemaname,tablename FROM pg_tables
        WHERE schemaname IN ('sb','portal') AND NOT (schemaname='sb' AND tablename='sessions')
        ORDER BY schemaname,tablename
      LOOP
        EXECUTE format('INSERT INTO lifecycle_snapshot SELECT %L,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM %I.%I t',
          item.schemaname||'.'||item.tablename,item.schemaname,item.tablename);
      END LOOP;
    END $snapshot$;
    SELECT COALESCE(jsonb_object_agg(name,fingerprint ORDER BY name),'{}'::jsonb) FROM lifecycle_snapshot;
  `));
  const credentials = await sql(dir, "SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(id,email,encrypted_password,email_confirmed_at,created_at,raw_user_meta_data,raw_app_meta_data) ORDER BY id)::text,'[]')) FROM auth.users");
  const mfa = await sql(dir, "SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(id,user_id,friendly_name,factor_type,status,secret,created_at) ORDER BY id)::text,'[]')) FROM auth.mfa_factors");
  const sessions = JSON.parse(await sql(dir, "SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id_hash,'user',user_id,'recovery',recovery_only,'expires',expires_at) ORDER BY id_hash),'[]'::jsonb) FROM sb.sessions"));
  const policies = await sql(dir, "SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname)::text,'[]')) FROM pg_policies p WHERE schemaname IN ('sb','portal','auth')");
  const ownership = await sql(dir, "SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,r.rolname,(SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(c.relacl) v),c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname,c.relkind)::text,'[]')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname IN ('sb','portal','auth')");
  const functions = await sql(dir, "SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),r.rolname,(SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl) v),p.prosecdef,p.proconfig) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))::text,'[]')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname IN ('sb','portal','auth')");
  const roles = await sql(dir, "SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig) ORDER BY rolname)::text,'[]')) FROM pg_roles WHERE rolname IN ('supabase_auth_admin','shadowbridge_api','shadowbridge_sessions','shadowbridge_policy')");
  const migrations = JSON.parse(await sql(dir, 'SELECT jsonb_agg(jsonb_build_object(\'name\',name,\'sha256\',sha256) ORDER BY name) FROM shadowbridge_migrations.applied'));
  return { business, credentials, mfa, sessions, policies, ownership, functions, roles, migrations };
}
function preserved(before, after, { exactSessions = false } = {}) {
  for (const key of ['business','credentials','mfa','policies','ownership','functions','roles','migrations']) requireSame(after[key], before[key], `${key} changed during a persistence operation`);
  const afterIds = new Set(after.sessions.map(session => session.id));
  assert.ok(before.sessions.every(session => afterIds.has(session.id)), 'An existing BFF session was lost');
  if (exactSessions) requireSame(after.sessions, before.sessions, 'Recovered BFF session records differ');
}
async function originalInstallation() {
  const names = ['shadowbridge-private-local-postgres-1','shadowbridge-private-local-auth-1','shadowbridge-private-local-mailpit-1'];
  let containers;
  try { containers = execFileSync('docker', ['--context','default','inspect','--format','{{.Id}} {{.Name}} {{.State.Status}}',...names], { encoding:'utf8',stdio:['ignore','pipe','pipe'] }).trim(); }
  catch { throw new Error('Cannot establish the original-container safety baseline.'); }
  const files = {};
  for (const name of ['development.env','demo-accounts.json']) {
    try { files[name] = sha(await readFile(path.join(repositoryRoot,'.local',name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { containers, files };
}
function actorEntries(record) {
  const value = record.actors;
  assert.ok(value && typeof value === 'object', 'Real UI fixture record is missing actors');
  return Array.isArray(value) ? value.map((actor,index) => [actor.label || actor.role || String(index),actor]) : Object.entries(value);
}
function cookieHeader(actor) {
  const cookies = actor.cookies || actor.client?.cookies;
  assert.ok(cookies, 'Private fixture does not contain a retained BFF cookie');
  if (typeof cookies === 'string') return cookies;
  if (Array.isArray(cookies)) return cookies.map(cookie => Array.isArray(cookie) ? cookie.join('=') : `${cookie.name}=${cookie.value}`).join('; ');
  return Object.entries(cookies).map(([name,value]) => `${name}=${value}`).join('; ');
}
async function request(dir, pathname, actor, options = {}) {
  const checked = await checkStaging({ directory:dir });
  const password = (await readFile(path.join(dir,'tester-password'),'utf8')).trim();
  const headers = { Accept:'application/json', Authorization:`Basic ${Buffer.from(`reviewer:${password}`).toString('base64')}`, ...options.headers };
  if (actor) headers.Cookie = cookieHeader(actor);
  const response = await fetch(new URL(pathname,checked.origin), { ...options, headers, redirect:'manual',signal:AbortSignal.timeout(10_000) });
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!data) await response.arrayBuffer();
  return { status:response.status,data,headers:response.headers };
}
async function ready(dir) {
  const end=Date.now()+60_000;
  while(Date.now()<end) {
    try {if((await request(dir,'/health')).status===200) return;} catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Private TLS application did not become healthy in time.');
}
async function retainedSessions(dir, record) {
  let checked=0;
  for (const [label,actor] of actorEntries(record)) {
    if (!(actor.cookies || actor.client?.cookies)) continue;
    const response=await request(dir,'/api/session',actor);
    assert.ok(response.status===200 && response.data?.user?.id === (actor.userId || actor.user?.id || actor.id), `Retained fictional ${label} session was not recovered`);
    if (actor.mfaSecret || actor.factorId || actor.aal==='aal2' || label==='owner') assert.ok(response.data.user.aal==='aal2',`Retained fictional ${label} MFA level was lost`);
    checked++;
  }
  assert.ok(checked>=4,'At least Buyer, Supplier, Partner and OWNER retained sessions must be checked');
  return checked;
}
async function freshCredentialsWork(dir,record) {
  const saved=structuredClone(record);
  const entries=actorEntries(saved);
  const buyer=entries.find(([label,actor])=>label==='buyerA'||actor.role==='buyer')?.[1];
  const owner=entries.find(([label])=>label==='owner')?.[1];
  assert.ok(buyer?.email&&buyer.password&&owner?.factorId&&owner.mfaSecret,'Recoverable fictional password and MFA fixtures are required');
  const checked=await checkStaging({directory:dir});
  const config=await request(dir,'/api/config');
  assert.equal(config.status,200);
  const cookies=config.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const signedIn=await request(dir,'/api/auth/login',undefined,{method:'POST',headers:{Cookie:cookies,Origin:checked.origin,'Content-Type':'application/json','X-CSRF-Token':config.data.csrfToken},body:JSON.stringify({email:buyer.email,password:buyer.password})});
  assert.ok(signedIn.status===200&&signedIn.data?.user?.id===buyer.user.id,'Original fictional Buyer password was not accepted');
  const ownerConfig=await request(dir,'/api/config',owner);
  const verified=await request(dir,'/api/auth/mfa/verify',owner,{method:'POST',headers:{Origin:checked.origin,'Content-Type':'application/json','X-CSRF-Token':ownerConfig.data.csrfToken},body:JSON.stringify({factorId:owner.factorId,code:totp(owner.mfaSecret)})});
  assert.equal(verified.status,200,'Original fictional owner authenticator was not accepted');
  // MFA rotates only this test session. Retain its replacement privately so
  // subsequent operator checks do not accidentally reuse the revoked cookie.
  const retained=new Map(cookieHeader(owner).split('; ').map(value=>{const at=value.indexOf('=');return[value.slice(0,at),value.slice(at+1)];}));
  for(const value of verified.headers.getSetCookie()) {
    const pair=value.split(';')[0],at=pair.indexOf('=');
    if(/max-age=0(?:;|$)/i.test(value))retained.delete(pair.slice(0,at));
    else retained.set(pair.slice(0,at),pair.slice(at+1));
  }
  owner.client={...owner.client,cookies:[...retained],csrf:verified.data?.csrfToken||owner.client?.csrf};
  Object.assign(saved,{origin:checked.origin,project:checked.project});
  await writeFile(path.join(dir,'test-record.json'),JSON.stringify(saved)+'\n',{mode:0o600});
}

try {
  const checked=await checkStaging({directory});
  assert.equal(checked.project,'shadowbridge-stageg-g3-tests','Only the dedicated G3 source test project is accepted');
  const privateRecord=path.join(directory,'test-record.json');
  assert.equal((await stat(privateRecord)).mode & 0o777,0o600,'Test actor record must remain private');
  const record=JSON.parse(await readFile(privateRecord,'utf8'));
  const original=await originalInstallation();
  const configHash=sha(await readFile(path.join(directory,'manifest.json')));
  await ready(directory);
  const baseline=await snapshot(directory);
  const sources=await migrationSources();
  requireSame(baseline.migrations,sources.map(({name,sha256})=>({name,sha256})),'The real database migration ledger differs from source');
  assert.ok(sources.length>=11,'This regression requires the complete source migration history');
  await retainedSessions(directory,record);
  pass('isolated real source, verified TLS, stored sessions and complete source migration provenance');

  current='stop and start';
  await operate({action:'stop',directory});
  assert.equal((await compose(directory,['ps','--services','--status','running'],{capture:true})).trim(),'','Stop must leave no G3 services running');
  await operate({action:'start',directory}); await ready(directory);
  preserved(baseline,await snapshot(directory)); await retainedSessions(directory,record);
  assert.equal(sha(await readFile(path.join(directory,'manifest.json'))),configHash,'Private configuration changed');
  pass('stop/start preserves business data, password hashes, MFA, sessions, permissions and secrets');

  current='container restart';
  await operate({action:'restart',directory}); await ready(directory);
  preserved(baseline,await snapshot(directory)); await retainedSessions(directory,record);
  pass('PostgreSQL/Auth/API/gateway restart preserves the existing test installation');

  current='safe update';
  await operate({action:'update',directory}); await ready(directory);
  preserved(baseline,await snapshot(directory)); await retainedSessions(directory,record);
  assert.equal(sha(await readFile(path.join(directory,'manifest.json'))),configHash,'Update rotated private configuration');
  pass('image update with automatic encrypted backup reapplies zero migrations and preserves data');

  current='encrypted backup and full restore';
  const beforeRecovery=await snapshot(directory);
  const recovery=await backupInstallation(directory); await ready(directory);
  assert.equal((await stat(recovery.backupFile)).mode & 0o777,0o600,'Encrypted backup must be private');
  assert.equal((await stat(recovery.keyFile)).mode & 0o777,0o600,'Recovery key must be private');
  const id=randomBytes(6).toString('hex');
  restored=await restoreInstallation({directory:path.join(repositoryRoot,'.local',`contabo-restore-${id}`),project:`shadowbridge-stageg-restore-${id}`,httpsPort:18444,...recovery});
  await ready(restored.directory);
  preserved(beforeRecovery,await snapshot(restored.directory),{exactSessions:true});
  await retainedSessions(restored.directory,record);
  pass('authenticated backup restores full database ownership/RLS/ACL, password hashes, MFA and live sessions in a NEW project');

  current='source and owner-installation safety';
  preserved(baseline,await snapshot(directory)); await retainedSessions(directory,record);
  requireSame(await originalInstallation(),original,'Original local owner installation or its configuration was altered');
  pass('source installation and original owner containers/configuration remain intact');
  current='fresh recovered password and authenticator';
  await freshCredentialsWork(directory,record);
  await freshCredentialsWork(restored.directory,record);
  pass('original Buyer password and a fresh OWNER authenticator code work after update and full recovery');
  await writeFile(reportFile,JSON.stringify({kind:'shadowbridge-contabo-real-lifecycle',createdAt:new Date().toISOString(),passed:results.length,failed:0,results,sourceProject:checked.project,restoreProject:restored.project,restoreDirectory:restored.directory,schemasCompared:['sb','portal'],passwordHashesCompared:true,mfaCompared:true,sessionIdentityRetained:true,ownershipAndPoliciesCompared:true,externalEmailsSent:false,ownerDataTouched:false},null,2)+'\n',{mode:0o600});
  console.log(`Real lifecycle complete: ${results.length}/${results.length}. No source database reset or volume removal.`);
} catch(error) {
  // Never emit arbitrary assertion payloads, cookie values, SQL or provider text.
  results.push({name:current,status:'FAIL'});
  const reason=error?.code==='ERR_ASSERTION' ? String(error.message).split('\n')[0].slice(0,200) : 'Private installation operation failed; no source reset was requested.';
  await writeFile(reportFile,JSON.stringify({kind:'shadowbridge-contabo-real-lifecycle',createdAt:new Date().toISOString(),passed:results.filter(result=>result.status==='PASS').length,failed:1,results,stoppedAt:current,reason},null,2)+'\n',{mode:0o600}).catch(()=>{});
  console.error(`FAIL: ${current}. Source data and volumes retained. Details require private local inspection.`);
  process.exitCode=1;
}
