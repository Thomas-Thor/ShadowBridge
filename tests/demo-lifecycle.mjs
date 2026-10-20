// Operator-run integration regression. It NEVER stops the normal local stack.
// Prepare source-only archives of a4582db and the candidate in separate /tmp
// directories, each with .shadowbridge-stage2-fixture and dependencies present.
// Pause the original stack only after its backup. This test refuses its project.
// node tests/demo-lifecycle.mjs --baseline=/tmp/... --candidate=/tmp/...
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, rename, realpath, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { Client } from '../server/tests/helpers.mjs';
import { totp } from '../scripts/demo.mjs';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = arg('baseline');
const candidate = arg('candidate');
const safetyOnly = process.argv.includes('--safety-only');
const freshProject = `shadowbridge-stage2-fresh-${randomBytes(3).toString('hex')}`;
const upgradeProject = arg('project') || 'shadowbridge-stage2-regression';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let running;
let database;
let passed = 0;
function pass(message) { console.log(`PASS ${++passed}: ${message}`); }
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

async function environment(directory, project) {
  const content = await readFile(path.join(directory, '.local/development.env'), 'utf8');
  return { ...process.env, ...Object.fromEntries(content.trim().split('\n').map(line => {
    const i = line.indexOf('='); return [line.slice(0,i), line.slice(i+1)];
  })), COMPOSE_PROJECT_NAME: project };
}
async function guard(directory) {
  assert.ok(directory && (await realpath(directory)).startsWith('/tmp/ShadowBridge-stage2-'), 'Explicit isolated /tmp source fixture required');
  const marker = JSON.parse(await readFile(path.join(directory, '.shadowbridge-stage2-fixture'), 'utf8'));
  assert.equal(marker.kind, 'shadowbridge-stage2-isolated-lifecycle');
}
function compose(directory, project, command) {
  return execFileSync('docker', ['compose','--env-file','.local/development.env','-f','local/compose.yaml',...command], {
    cwd: directory, env: {...process.env, COMPOSE_PROJECT_NAME:project}, stdio:['ignore','pipe','pipe'], encoding:'utf8',
  });
}
async function stopApp() {
  if (!running) return;
  const current = running; running = undefined;
  if (current.child.exitCode === null && current.child.signalCode === null) {
    process.kill(-current.child.pid, 'SIGINT');
    await Promise.race([current.closed, sleep(15_000).then(() => { throw new Error('Demo did not shut down gracefully'); })]);
  }
}
async function startDemo(directory, project) {
  assert.ok(!running, 'Do not launch two applications on the same port');
  const child = spawn('npm',['run','demo'], {cwd:directory, env:{...process.env,COMPOSE_PROJECT_NAME:project}, detached:true, stdio:['ignore','pipe','pipe']});
  let output = '';
  const closed = new Promise(resolve => child.once('exit', (code,signal) => resolve({code,signal})));
  const receive = data => { output += data.toString(); };
  child.stdout.on('data',receive); child.stderr.on('data',receive);
  running = {child,closed};
  const deadline = Date.now()+180_000;
  while (!output.includes('MVP gotowy:')) {
    if (child.exitCode !== null || child.signalCode !== null) {
      // Demo deliberately logs sanitized messages, never credentials.
      throw new Error(`Demo stopped before readiness (exit ${child.exitCode}): ${output.slice(-1400)}`);
    }
    assert.ok(Date.now()<deadline,'Demo readiness timed out');
    await sleep(250);
  }
  assert.equal((await fetch('http://127.0.0.1:8088/api/config')).status,200);
  return JSON.parse(await readFile(path.join(directory,'.local/demo-accounts.json'),'utf8'));
}
async function connect(directory,project) {
  const env=await environment(directory,project);
  database = new pg.Client({connectionString:env.DATABASE_ADMIN_URL,application_name:'shadowbridge-stage2-lifecycle-regression'});
  await database.connect();
  return env;
}
async function disconnect() { if(database){await database.end();database=undefined;} }
async function snapshot(directory, record) {
  const hashes = {};
  const tables=['accounts','companies','applications','memberships','offers','rfqs','partner_proposals','professional_profiles','projects','commissions','opportunity_sources','opportunity_grants'];
  for (const table of tables) {
    const {rows}=await database.query(`SELECT to_jsonb(t)-'category_id'-'subcategory_id'-'classification_review_required' AS row FROM sb.${table} t ORDER BY to_jsonb(t)::text`);
    hashes[table]=digest(rows.map(item=>item.row));
  }
  hashes.opportunities=digest((await database.query("SELECT to_jsonb(t)-'category_id'-'subcategory_id'-'classification_review_required' AS row FROM portal.opportunities t ORDER BY public_id")).rows);
  hashes.passwords=digest((await database.query('SELECT id,email,encrypted_password,email_confirmed_at,created_at,raw_user_meta_data,raw_app_meta_data FROM auth.users ORDER BY id')).rows);
  hashes.factors=digest((await database.query('SELECT id,user_id,secret,factor_type,status,friendly_name,created_at FROM auth.mfa_factors ORDER BY id')).rows);
  hashes.environment=digest(await readFile(path.join(directory,'.local/development.env'),'utf8'));
  hashes.fixtureIdentity=digest({id:record.id,actors:record.actors,mfa:record.mfa,fixtures:record.fixtures});
  return hashes;
}
async function clientsFor(record, includeMfa=true) {
  const result={};
  for(const label of ['buyer','supplier','partner','owner']) {
    const client=new Client(); await client.signIn(record.actors[label]); result[label]=client;
  }
  if(includeMfa) {
    const owner=result.owner;
    let verified=await owner.request('/api/auth/mfa/verify',{method:'POST',body:{factorId:record.mfa.factorId,code:totp(record.mfa.secret)}});
    if(verified.status!==200) {
      await sleep(31000-Date.now()%30000);
      verified=await owner.request('/api/auth/mfa/verify',{method:'POST',body:{factorId:record.mfa.factorId,code:totp(record.mfa.secret)}});
    }
    assert.equal(verified.status,200,'Owner requires real MFA');
  }
  return result;
}
async function sessionsSurvive(clients,record) {
  for(const [label,client] of Object.entries(clients)) {
    const response=await client.request('/api/session',{expected:200});
    assert.equal(response.data.user.id,record.actors[label].userId,`${label} session survives`);
    if(label==='owner')assert.equal(response.data.user.aal,'aal2');
  }
  const buyerCards=(await clients.buyer.request('/api/opportunities',{expected:200})).data.items;
  assert.ok(buyerCards.some(card=>card.id===record.fixtures.opportunity));
  assert.equal((await clients.partner.request('/api/opportunities',{expected:200})).data.items.length,0);
}
async function credentialsRemainInteractiveOnly(directory,project) {
  for(const command of ['demo:accounts','demo:code']) {
    const output=await new Promise(resolve=> {
      const child=spawn('npm',['run',command],{cwd:directory,env:{...process.env,COMPOSE_PROJECT_NAME:project},stdio:['ignore','pipe','pipe']});
      let text='';child.stdout.on('data',chunk=>{text+=chunk;});child.stderr.on('data',chunk=>{text+=chunk;});child.once('exit',code=>resolve({code,text}));
    });
    assert.equal(output.code,1,'Credential CLI refuses non-interactive logs');
    assert.match(output.text,/interactive terminal/);
    const actors=JSON.parse(await readFile(path.join(directory,'.local/demo-accounts.json'),'utf8')).actors;
    for(const actor of Object.values(actors))assert.ok(!output.text.includes(actor.password));
  }
}
async function boundaryChecks(directory,project) {
  const env={...process.env,COMPOSE_PROJECT_NAME:project};
  const record=JSON.parse(await readFile(path.join(directory,'.local/demo-accounts.json'),'utf8'));
  const collision=spawn('npm',['run','demo'],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
  let collisionOutput='';
  collision.stdout.on('data',chunk=>{collisionOutput+=chunk;});collision.stderr.on('data',chunk=>{collisionOutput+=chunk;});
  const collisionCode=await new Promise(resolve=>collision.once('exit',resolve));
  assert.equal(collisionCode,1);assert.match(collisionOutput,/Port 8088 jest zajęty/);
  assert.equal((await fetch('http://127.0.0.1:8088/api/config')).status,200);
  pass('occupied port fails before touching credentials or stopping the existing test application');
  for(const command of ['demo:accounts','demo:code']) {
    const before=totp(record.mfa.secret);
    const output=execFileSync('script',['-q','-e','-c',`npm run ${command}`,'/dev/null'],{cwd:directory,env,input:'',stdio:['pipe','pipe','pipe'],encoding:'utf8'});
    if(command==='demo:accounts')for(const actor of Object.values(record.actors))assert.ok(output.includes(actor.email)&&output.includes(actor.password),'TTY displays only the generated local credentials');
    else assert.ok(output.includes(before)||output.includes(totp(record.mfa.secret)),'TTY displays a real current TOTP');
  }
  pass('genuine TTY credential and MFA helpers work; their captured output is never logged');
  const pid=Number((await readFile(path.join(directory,'.local/stage2-demo.pid'),'utf8')).trim());
  assert.ok(pid>1);
  // The guarded fixture marker and private PID were created by this runner.
  // ps works on managed hosts that intentionally forbid /proc/PID/cwd access.
  assert.match(execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}),/^npm run demo\s*$/);
  process.kill(-pid,'SIGINT');
  for(let i=0;i<60;i++){
    let responding=false;try{responding=(await fetch('http://127.0.0.1:8088/api/config')).ok;}catch{}
    if(!responding)break;
    assert.ok(i<59,'Test-owned application must stop');await sleep(100);
  }
  const userId=record.actors.buyer.userId;
  const oldAccount=(await database.query('SELECT status FROM sb.accounts WHERE user_id=$1',[userId])).rows[0];
  const oldApplication=(await database.query('SELECT id,status FROM sb.applications WHERE user_id=$1',[userId])).rows[0];
  const oldPassword=(await database.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[userId])).rows[0].encrypted_password;
  // Controlled DBA fixture setup, equivalent to the isolated SQL/RLS tests.
  // This connection is never used by the application or original installation.
  await database.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal','aal2',false)",[record.actors.owner.userId]);
  try {
    await database.query("UPDATE sb.accounts SET status='suspended' WHERE user_id=$1",[userId]);
    await assert.rejects(startDemo(directory,project),/before readiness/);await stopApp();
    assert.equal((await database.query('SELECT status FROM sb.accounts WHERE user_id=$1',[userId])).rows[0].status,'suspended');
    pass('suspended fictional account is refused and never automatically reactivated by demo');
    await database.query('UPDATE sb.accounts SET status=$2 WHERE user_id=$1',[userId,oldAccount.status]);
    await database.query("UPDATE sb.applications SET status='rejected' WHERE id=$1",[oldApplication.id]);
    await assert.rejects(startDemo(directory,project),/before readiness/);await stopApp();
    assert.equal((await database.query('SELECT status FROM sb.applications WHERE id=$1',[oldApplication.id])).rows[0].status,'rejected');
    pass('rejected fictional application is refused and never automatically approved by demo');
    assert.equal((await database.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[userId])).rows[0].encrypted_password,oldPassword);
  } finally {
    // This is the explicitly isolated regression fixture, never an owner DB.
    await database.query('UPDATE sb.accounts SET status=$2 WHERE user_id=$1',[userId,oldAccount.status]);
    await database.query('UPDATE sb.applications SET status=$2 WHERE id=$1',[oldApplication.id,oldApplication.status]);
  }
  await startDemo(directory,project);
}
async function detachDemo() {
  await writeFile(path.join(candidate,'.local/stage2-demo.pid'),String(running.child.pid)+'\n',{mode:0o600});
  running.child.stdout.destroy();running.child.stderr.destroy();running.child.unref();running=undefined;
}

try {
  await guard(baseline);await guard(candidate);
  assert.match(upgradeProject,/^shadowbridge-stage2-[a-z0-9-]+$/,'Only an explicitly isolated test project is allowed');
  const original=execFileSync('docker',['ps','--filter','label=com.docker.compose.project=shadowbridge-private-local','--format','{{.ID}}'],{encoding:'utf8'}).trim();
  assert.equal(original,'','Original stack must be backed up and paused by its operator first');
  if(safetyOnly){
    await connect(candidate,upgradeProject);await boundaryChecks(candidate,upgradeProject);await disconnect();await detachDemo();
    console.log(`Lifecycle boundary regression complete: ${passed}/${passed}; isolated candidate app restored and running.`);
    process.exit(0);
  }
  const existingVolumes=execFileSync('docker',['volume','ls','--filter',`label=com.docker.compose.project=${upgradeProject}`,'--format','{{.Name}}'],{encoding:'utf8'}).trim();
  assert.equal(existingVolumes,'','Select a new --project for each fresh regression; existing test volumes are never reset');
  let fresh=await startDemo(candidate,freshProject);
  await connect(candidate,freshProject);
  const freshClients=await clientsFor(fresh);
  const freshBefore=await snapshot(candidate,fresh);
  pass('fresh current npm run demo: real registration, e-mail confirmation, MFA, approvals and confidential fixtures');
  await credentialsRemainInteractiveOnly(candidate,freshProject);
  pass('credential and MFA helper commands refuse redirected output');
  await disconnect();await stopApp();
  compose(candidate,freshProject,['down']);
  fresh=await startDemo(candidate,freshProject);
  await connect(candidate,freshProject);
  assert.deepEqual(await snapshot(candidate,fresh),freshBefore);
  await sessionsSurvive(freshClients,fresh);
  pass('fresh demo and all containers restart: records, random credentials, MFA, settings and live sessions preserved');
  await disconnect();await stopApp();compose(candidate,freshProject,['down']);
  await rename(path.join(candidate,'.local'),path.join(candidate,`.local-${freshProject}`));

  const legacy=await startDemo(baseline,upgradeProject);
  await connect(baseline,upgradeProject);
  const clients=await clientsFor(legacy);
  const before=await snapshot(baseline,legacy);
  const oldSessions=(await database.query('SELECT id_hash FROM sb.sessions ORDER BY id_hash')).rows.map(row=>row.id_hash);
  assert.equal((await database.query('SELECT count(*)::int n FROM shadowbridge_migrations.applied')).rows[0].n,5);
  const dump=execFileSync('docker',['exec',`${upgradeProject}-postgres-1`,'pg_dump','-U','postgres','-d','shadowbridge','--format=custom'],{maxBuffer:8*1024*1024});
  await writeFile(path.join(baseline,'.local/pre-upgrade-regression.dump'),dump,{mode:0o600,flag:'wx'});
  pass('real a4582db installation prepared with active sessions and pre-upgrade database backup');
  await disconnect();await stopApp();
  await mkdir(path.join(candidate,'.local'),{mode:0o700});
  for(const file of ['development.env','demo-accounts.json'])await copyFile(path.join(baseline,'.local',file),path.join(candidate,'.local',file));
  const upgraded=await startDemo(candidate,upgradeProject);
  await connect(candidate,upgradeProject);
  assert.deepEqual(await snapshot(candidate,upgraded),before);
  const newSessions=new Set((await database.query('SELECT id_hash FROM sb.sessions')).rows.map(row=>row.id_hash));
  assert.ok(oldSessions.every(id=>newSessions.has(id)),'No pre-upgrade BFF session was deleted');
  const candidateMigrations=(await readdir(path.join(candidate,'supabase/migrations'))).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const appliedMigrations=(await database.query('SELECT name,sha256 FROM shadowbridge_migrations.applied ORDER BY name')).rows;
  assert.deepEqual(appliedMigrations.map(row=>row.name),candidateMigrations,'Every final candidate migration is applied exactly once');
  for(const row of appliedMigrations)assert.equal(row.sha256,digest(await readFile(path.join(candidate,'supabase/migrations',row.name),'utf8')),'Applied migration checksum matches final source');
  const flagged=(await database.query("SELECT count(*)::int n FROM sb.offers WHERE classification_review_required UNION ALL SELECT count(*)::int n FROM sb.rfqs WHERE classification_review_required UNION ALL SELECT count(*)::int n FROM portal.opportunities WHERE classification_review_required")).rows;
  assert.deepEqual(flagged.map(row=>row.n),[1,1,1],'Ambiguous legacy categories remain flagged for review');
  await sessionsSurvive(clients,upgraded);
  pass(`upgrade a4582db to candidate: ${candidateMigrations.length} migrations, password hashes/MFA/settings/data unchanged, sessions survive, ambiguous categories flagged`);
  // A valid old session must support a mutation after obtaining the new CSRF
  // binding, rather than merely render a cached authenticated page.
  const response=await clients.buyer.request('/api/auth/logout',{method:'POST',body:{},expected:200});
  assert.equal(response.data.signedOut,true);
  await clients.buyer.signIn(upgraded.actors.buyer);
  pass('pre-upgrade session can fetch current CSRF, log out, and authenticate with the unchanged password');
  const currentBefore=await snapshot(candidate,upgraded);
  await disconnect();await stopApp();compose(candidate,upgradeProject,['down']);
  const restarted=await startDemo(candidate,upgradeProject);
  await connect(candidate,upgradeProject);
  assert.deepEqual(await snapshot(candidate,restarted),currentBefore);
  await sessionsSurvive(clients,restarted);
  pass('upgraded application and containers restart without account/record duplication or loss of live sessions');
  console.log(`Lifecycle regression complete: ${passed}/${passed}; candidate app and isolated ${upgradeProject} intentionally left running for further regression.`);
  await disconnect();
  // Do not await the long-running application; retain its PID privately for
  // the coordinating operator and detach only the test-owned process group.
  await detachDemo();
} catch(error) {
  await disconnect().catch(()=>{});await stopApp().catch(()=>{});
  console.error(error.stack);process.exitCode=1;
}
