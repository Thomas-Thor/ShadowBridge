// Isolated PostgreSQL test. Uses only retained FICTIONAL R1 fixtures on /tmp.
// GoTrue login itself is not simulated as a successful production test here:
// database claims/factors are explicit fixtures for the authorization boundary.
import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
import{randomBytes,randomUUID,createHash}from'node:crypto';import{readFile,writeFile,mkdir,stat}from'node:fs/promises';
import{inspectSpace}from'../scripts/workspace-space.mjs';import{encryptArchive,decryptArchive}from'../scripts/staging-backup.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
const pool='/tmp/shadowbridge-r1-isolated',D=['--host','unix://'+pool+'/overlay.sock'],pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';
assert.equal((await inspectSpace({directory:pool,dockerRoot:pool+'/overlay-data',workspace:process.cwd()})).result,'PASS');
const marker=JSON.parse(execFileSync('docker',[...D,'inspect',pg]))[0];assert.equal(marker.Config.Labels['com.docker.compose.project'],'shadowbridge-stageg-r1full-cd6f2078e0');
const tag=randomBytes(4).toString('hex'),db='owner_book_test_'+tag,restored='owner_book_restore_'+tag,executor='sb_book_executor_'+tag;
const dir=new URL('../.local/owner-book-'+tag+'/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const report={kind:'real-postgresql-owner-command-book',cases:[],productionChanges:false,realUsersUsed:false,externalRequests:false,goTrueInteractiveLoginTested:false};
const literal=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>literal(JSON.stringify(v))+'::jsonb';
function sql(q,{database=db,role,owner,aal='aal2',fresh=true}={}){
 const prefix=(role?'SET SESSION AUTHORIZATION '+role+';':'')+'BEGIN;'+(owner?`SET LOCAL "request.jwt.claim.sub"=${literal(owner)};SET LOCAL "request.jwt.claim.aal"=${literal(aal)};SET LOCAL "request.jwt.claim.mfa_verified_at"=${literal(String(Math.floor(Date.now()/1000)-(fresh?0:1000)))};`:'');
 try{return execFileSync('docker',[...D,'exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:prefix+q+';COMMIT;',encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024**2}).trim();}catch(e){throw Object.assign(Error('Isolated SQL rejected'),{diagnostic:String(e.stderr)});}
}
const raw=(q,database='postgres')=>execFileSync('docker',[...D,'exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const rpc=(owner,action,kind,p={},extra={})=>JSON.parse(sql(`SELECT owner_book.owner_rpc(${literal(action)},${kind?literal(kind):'NULL'},${j(p)},${literal(randomUUID())}::uuid,${literal(extra.command??randomUUID())}::uuid)`,{role:'shadowbridge_api',owner,...extra}));
const digest=s=>createHash('sha256').update(s).digest('hex');
const token=(key,action,kind,p={},opts={})=>JSON.parse(sql(`SELECT owner_book.token_rpc(${literal(key)},${literal(action)},${kind?literal(kind):'NULL'},${j(p)},${opts.command?literal(opts.command)+'::uuid':'NULL'},${opts.explicit===true},${literal(digest('fictional-client'))},${literal(randomUUID())}::uuid)`,{role:'shadowbridge_sessions',owner:opts.forgedOwner,database:opts.database??db}));
const phase=async(name,fn)=>{await fn();report.cases.push({name,result:'PASS'});console.log('PASS '+name);await writeFile(new URL('results.json',dir),JSON.stringify(report,null,2)+'\n',{mode:0o600});};
const protectedPrint=database=>JSON.parse(raw(`SELECT jsonb_object_agg(name,h) FROM (SELECT name,(xpath('/row/h/text()',query_to_xml(format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) AS h FROM %s t',name),false,true,'')))[1]::text h FROM (SELECT quote_ident(schemaname)||'.'||quote_ident(tablename) name FROM pg_tables WHERE schemaname IN ('sb','auth','owner_vault') AND tablename NOT IN ('schema_migrations'))s)q`,database));
const initialSource=protectedPrint('shadowbridge');
const users={};let before;
try{
 raw('CREATE DATABASE '+db+' TEMPLATE shadowbridge');
 for(const role of ['owner','owner2','general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst','buyer','supplier','partner']){
  const id=randomUUID();users[role]=id;sql(`INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at) VALUES(${literal(id)},${literal('fictional-'+role+'-'+tag+'@ownerbook.test.invalid')},now(),now(),now());INSERT INTO sb.accounts(user_id,email,email_verified_at) VALUES(${literal(id)},${literal('fictional-'+role+'-'+tag+'@ownerbook.test.invalid')},now()) ON CONFLICT(user_id) DO UPDATE SET email_verified_at=excluded.email_verified_at;INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,secret) VALUES(${literal(randomUUID())},${literal(id)},'totp','verified',now(),now(),${literal(randomBytes(20).toString('hex'))});`);
  if(!['buyer','supplier','partner'].includes(role))sql(`INSERT INTO sb.staff_grants(user_id,active) VALUES(${literal(id)},true);INSERT INTO sb.staff_role_assignments(user_id,role_key) VALUES(${literal(id)},${literal(role==='owner2'?'owner':role)})`);
 }
 before=protectedPrint(db);
 const pre=execFileSync('docker',[...D,'exec',pg,'pg_dump','-Fc','-U','postgres','-d',db],{maxBuffer:64*1024**2});await writeFile(new URL('before-018.dump',dir),pre,{mode:0o600});
 await phase('018 applies transactionally and preserves all pre-existing accounts, MFA, sessions, roles and CRM rows',async()=>{
  const source=await readFile(new URL('../supabase/migrations/202610240018_owner_command_book.sql',import.meta.url),'utf8');
  raw(source.replaceAll('shadowbridge_book_executor',executor),db);assert.deepEqual(protectedPrint(db),before);
  assert.equal(sql("SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_book' AND c.relkind='r'"),'t');
 });
 await phase('OWNER requires verified MFA; every other real role and all raw table/CRM-secret reads are denied',async()=>{
  for(const role of Object.keys(users).filter(x=>!['owner','owner2'].includes(x)))assert.equal(rpc(users[role],'summary',null).status,403,role);
  assert.equal(rpc(users.owner,'summary',null,{}, {aal:'aal1'}).status,403);assert.equal(rpc(users.owner,'summary',null).status,200);
  for(const runtime of ['shadowbridge_api','shadowbridge_sessions']){assert.throws(()=>sql('SELECT * FROM owner_book.entries',{role:runtime}));assert.throws(()=>sql('SELECT token_hash FROM owner_book.api_keys',{role:runtime}));assert.throws(()=>sql('SET ROLE '+executor,{role:runtime}));}
 });
 let task,dependent,note;
 await phase('tasks, dependency cycles, blocked completion, optimistic edits, archive, search and immutable history work',async()=>{
  const make=(p,opts)=>rpc(users.owner,'save',p.kind,p,opts);
  task=make({kind:'task',title:'FICTIONAL prerequisite',body:'FICTIONAL work',priority:'high',status:'open'}).data;assert.ok(task.id);
  dependent=make({kind:'task',title:'FICTIONAL dependent',dependencies:[task.id],status:'open'}).data;
  assert.equal(make({kind:'task',id:dependent.id,version:dependent.version,title:dependent.title,dependencies:[task.id],status:'done'}).status,400);
  assert.equal(make({kind:'task',id:task.id,version:task.version,title:task.title,dependencies:[dependent.id]}).status,400);
  task=make({kind:'task',id:task.id,version:task.version,title:task.title,status:'done'}).data;
  assert.equal(make({kind:'task',id:task.id,version:1,title:'stale'}).status,409);
  dependent=make({kind:'task',id:dependent.id,version:dependent.version,title:dependent.title,dependencies:[task.id],status:'done',archived:true}).data;
  note=make({kind:'note',title:'FICTIONAL commercial memory',body:'Fictional packaging context'}).data;
  assert.equal(rpc(users.owner,'list','note',{q:'packaging'}).data.total,1);assert.equal(rpc(users.owner,'list','task',{archived:'true'}).data.total,1);
  const history=rpc(users.owner,'history','task',{id:task.id});assert.equal(history.data.total,2);assert.throws(()=>sql('UPDATE owner_book.history SET channel=channel'));
 });
 await phase('calendar, in-app reminders, decisions, ideas and browser command replay persist without duplicates',async()=>{
  assert.equal(rpc(users.owner,'save','event',{kind:'event',title:'FICTIONAL meeting',starts_at:'2026-10-25T02:30:00+02:00',ends_at:'2026-10-25T02:45:00+02:00',remind_at:'2020-01-01T00:00:00Z'}).status,200);
  assert.equal(rpc(users.owner,'save','decision',{kind:'decision',title:'FICTIONAL decision'},{fresh:false}).status,403);
  assert.equal(rpc(users.owner,'save','decision',{kind:'decision',title:'FICTIONAL decision'}).status,200);
  const key=randomUUID(),p={kind:'idea',title:'FICTIONAL repeat-safe idea'};const a=rpc(users.owner,'save','idea',p,{command:key}),b=rpc(users.owner,'save','idea',p,{command:key});assert.equal(a.data.id,b.data.id);assert.equal(rpc(users.owner,'save','idea',{...p,title:'Changed retry'},{command:key}).status,409);
  assert.equal(rpc(users.owner,'summary',null).data.reminders.length,1);
 });
 let ro,custom,admin,keyId;
 const createKey=(name,mode,scopes,extra={})=>{const rawKey='sbob_'+randomBytes(32).toString('base64url'),hash=digest(rawKey);const r=rpc(users.owner,'key_create',null,{name,mode,scopes,expiresAt:new Date(Date.now()+7*86400000).toISOString(),tokenHash:hash},extra);return{hash,rawKey,response:r};};
 await phase('fresh MFA issues named expiring scoped keys; key lists and exports contain no key or digest',async()=>{
  assert.equal(createKey('FICTIONAL stale','read_only',['task.read'],{fresh:false}).response.status,403);
  ro=createKey('FICTIONAL read only','read_only',['task.read','journal.read']);assert.equal(ro.response.status,200);keyId=ro.response.data.id;
  custom=createKey('FICTIONAL custom','custom',['note.read','note.write','summary.export']);admin=createKey('FICTIONAL limited admin','book_admin',[]);
  assert.equal(custom.response.status,200);assert.equal(admin.response.status,200);
  const keys=rpc(users.owner,'key_list',null).data;assert.ok(!JSON.stringify(keys).includes(ro.hash));assert.ok(!JSON.stringify(keys).includes(ro.rawKey));
  assert.equal(createKey('FICTIONAL escalated','custom',['vault.read']).response.status,400);
 });
 await phase('capability scopes, explicit commands and idempotency are enforced in PostgreSQL, without impersonating OWNER',async()=>{
  assert.equal(token(ro.hash,'list','task').status,200);assert.equal(token(ro.hash,'list','note').status,403);
  assert.equal(token(ro.hash,'save','task',{kind:'task',title:'forbidden'},{command:randomUUID(),explicit:true}).status,403);
  assert.equal(token(custom.hash,'save','note',{kind:'note',title:'FICTIONAL command'}).status,403);
  const command=randomUUID(),p={kind:'note',title:'FICTIONAL API command'};
  const a=token(custom.hash,'save','note',p,{command,explicit:true});assert.equal(a.status,200);assert.equal(token(custom.hash,'save','note',p,{command,explicit:true}).data.id,a.data.id);
  assert.equal(token(custom.hash,'save','note',{...p,title:'changed'},{command,explicit:true}).status,409);
  assert.equal(token(admin.hash,'key_create',null,{}).status,403);assert.equal(token(admin.hash,'get','vault',{id:note.id}).status,403);
  assert.equal(token(custom.hash,'export',null,{kinds:['task']}).status,403);
 });
 await phase('two OWNERs are isolated; losing verified MFA immediately disables delegated keys; revocation leaves the account unchanged',async()=>{
  assert.equal(rpc(users.owner2,'get','note',{id:note.id}).status,404);assert.equal(rpc(users.owner2,'list','note').data.total,0);
  assert.equal(token(custom.hash,'get','note',{id:note.id},{forgedOwner:users.owner2}).status,200);
  sql(`UPDATE auth.mfa_factors SET status='unverified' WHERE user_id=${literal(users.owner)}`);assert.equal(token(ro.hash,'list','task').status,401);sql(`UPDATE auth.mfa_factors SET status='verified' WHERE user_id=${literal(users.owner)}`);
  const account=sql(`SELECT md5(to_jsonb(a)::text) FROM sb.accounts a WHERE user_id=${literal(users.owner)}`);assert.equal(rpc(users.owner,'key_revoke',null,{id:keyId}).status,200);assert.equal(token(ro.hash,'list','task').status,401);assert.equal(sql(`SELECT md5(to_jsonb(a)::text) FROM sb.accounts a WHERE user_id=${literal(users.owner)}`),account);
 });
 await phase('import is additive and atomic; journal cites real sources and never invents runs or costs',async()=>{
  const p={items:[{kind:'note',title:'FICTIONAL imported agreement',source_ref:'FICTIONAL previous chat'}]},command=randomUUID();const a=rpc(users.owner,'import',null,p,{command});assert.equal(a.status,200);assert.equal(rpc(users.owner,'import',null,p,{command}).data.items[0].id,a.data.items[0].id);
  const before=sql('SELECT count(*) FROM owner_book.entries');assert.equal(rpc(users.owner,'import',null,{items:[{kind:'idea',title:'rollback item'},{kind:'not_valid',title:'bad'}]}).status,403);assert.equal(sql('SELECT count(*) FROM owner_book.entries'),before);
  for(const window of ['24h','7d','14d','since_login']){const r=rpc(users.owner,'journal',null,{window});assert.equal(r.status,200);assert.equal(r.data.automation.actualMoneyCost,null);assert.equal(r.data.automation.verifiedAgentRuns,null);assert.ok(r.data.items.every(x=>x.source&&x.sourceRef&&x.certainty==='recorded'));}
  const e=rpc(users.owner,'export',null,{kinds:['task','note','idea','event','decision']});assert.equal(e.status,200);assert.ok(!JSON.stringify(e.data).includes(ro.hash));assert.ok(!JSON.stringify(e.data).includes(ro.rawKey));
 });
 await phase('database rate limits and every failed/successful operation are audited without secrets',async()=>{
  const r=createKey('FICTIONAL quota','read_only',['task.read']);for(let i=0;i<60;i++)assert.equal(token(r.hash,'list','task').status,200);assert.equal(token(r.hash,'list','task').status,429);
  const audit=rpc(users.owner,'audit',null).data;assert.ok(audit.items.some(x=>x.outcome==='rate_limited'));assert.ok(!JSON.stringify(audit).includes(r.hash));assert.ok(!JSON.stringify(audit).includes(r.rawKey));
 });
 await phase('authenticated encrypted full backup restores all tables to a separate database without changing the source',async()=>{
  const source=execFileSync('docker',[...D,'exec',pg,'pg_dump','-Fc','-U','postgres','-d',db],{maxBuffer:64*1024**2});const archiveFile=new URL('full.dump',dir).pathname,backupFile=new URL('full.sbb',dir).pathname,keyFile=new URL('recovery.key',dir).pathname,opened=new URL('decrypted.dump',dir).pathname;
  await writeFile(archiveFile,source,{mode:0o600});await encryptArchive({archiveFile,backupFile,keyFile});await decryptArchive({backupFile,keyFile,archiveFile:opened});assert.equal((await stat(backupFile)).mode&0o777,0o600);
  assert.equal(digest(await readFile(opened)),digest(source));raw('CREATE DATABASE '+restored+' TEMPLATE template0');execFileSync('docker',[...D,'exec','-i',pg,'pg_restore','--exit-on-error','-U','postgres','-d',restored],{input:await readFile(opened),stdio:['pipe','pipe','pipe']});
  const tables=sql("SELECT tablename FROM pg_tables WHERE schemaname='owner_book' ORDER BY tablename").split('\n');for(const t of tables){assert.match(t,/^[a-z_]+$/);const q=`SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM owner_book.${t} x`;assert.equal(sql(q,{database:restored}),sql(q));}
  assert.deepEqual(protectedPrint(restored),protectedPrint(db));assert.equal(sql("SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_book' AND c.relkind='r'",{database:restored}),'t');report.encryptedBackupRestored=true;report.restoreDatabase=restored;
 });
 assert.deepEqual(protectedPrint('shadowbridge'),initialSource);report.sourceFixturePreserved=true;report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.message;await writeFile(new URL('private-failure.json',dir),JSON.stringify({stack:e.stack,diagnostic:e.diagnostic})+'\n',{mode:0o600});console.error('FAIL: private diagnostics retained in '+dir.pathname);process.exitCode=1;}
finally{report.databaseRetained=db;await writeFile(new URL('results.json',dir),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
