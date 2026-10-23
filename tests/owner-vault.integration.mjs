// Real PostgreSQL 17 + GoTrue + BFF. Creates ONLY a uniquely labelled fictional
// local project. Never loads .local/development.env or an existing installation.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { mkdir, writeFile, readFile, chmod, statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { createApp } from '../server/app.mjs';
import { createDatabase } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';
import { migrationSources } from '../scripts/staging-migrate.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const id=randomBytes(5).toString('hex'),project='shadowbridge-vault-test-'+id;
const directory=path.join(root,'.local','vault-test-'+id);
const configPath=path.join(directory,'compose.json');
const secrets=Object.fromEntries(['postgres','auth','api','sessions','jwt','worker'].map(k=>[k,randomBytes(32).toString('hex')]));
const result={kind:'real-owner-vault-foundation',cases:[],mocksUsed:false,externalEmailSent:false,existingInstallationModified:false,contaboDeployed:false};
const docker=(args,options={})=>execFileSync('docker',['--context','default',...args],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:20*1024*1024,...options}).trim();
const beforeExisting=docker(['ps','--format','{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort();
const compose=args=>docker(['compose','-p',project,'-f',configPath,...args]);
const port=service=>Number(compose(['port',service,service==='postgres'?'5432':'9999']).split(':').at(-1));
let app,db,admin,worker,current='fixture initialization';
async function phase(name,fn){current=name;await fn();result.cases.push({name,result:'PASS'});console.log('PASS: '+name);}
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const claims=(who,aal='aal2')=>`SET LOCAL ROLE shadowbridge_api;SELECT set_config('request.jwt.claim.sub',${literal(who.user.id)},true),set_config('request.jwt.claim.aal',${literal(aal)},true),set_config('request.jwt.claim.mfa_verified_at',extract(epoch FROM clock_timestamp())::text,true);`;
const credentials=()=>`Sb!${randomBytes(24).toString('base64url')}9a`;
async function denied(fn,code='42501'){await assert.rejects(fn,e=>e.code===code,'Expected SQLSTATE '+code);}
const jwt=role=>{const p=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return p+'.'+createHmac('sha256',secrets.jwt).update(p).digest('base64url');};
const record=(source='one',company='TEST-1',email='alex@fictional.invalid',kind='individual',profile='')=>({company:{name:'FICTIONAL '+company,country:'NO',registrationNumber:company,sector:'FICTIONAL trade'},contact:{fullName:'FICTIONAL Alex Example',title:'FICTIONAL manager',workEmail:email,emailKind:kind,professionalUrl:profile},source:{system:'manual',recordId:source}});
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const fingerprint=async()=> (await admin.query(`SELECT jsonb_build_object(
 'users',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.users t),
 'accounts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.accounts t),
 'mfa',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.mfa_factors t),
 'sessions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id_hash)::text,'[]')) FROM sb.sessions t),
 'providerSessions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.sessions t),
 'refreshTokens',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.refresh_tokens t),
 'companies',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sb.companies t),
 'memberships',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sb.memberships t),
 'grants',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.staff_grants t),
 'roles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,role_key)::text,'[]')) FROM sb.staff_role_assignments t)
 ) AS f`)).rows[0].f;
try {
 const space=await statfs(root);assert.ok(space.bavail*space.bsize>512*1024*1024,'At least 512 MiB free is required before an isolated fixture');
 await mkdir(path.join(root,'.local'),{recursive:true,mode:0o700});
 await mkdir(directory,{mode:0o700});
 await writeFile(path.join(directory,'fixture.json'),JSON.stringify({kind:'shadowbridge-owner-vault-isolated-v1',project})+'\n',{mode:0o600,flag:'wx'});
 await writeFile(path.join(directory,'bootstrap.sh'),await readFile(path.join(root,'deploy/staging/bootstrap.sh')),{mode:0o644,flag:'wx'});
 await chmod(path.join(directory,'bootstrap.sh'),0o644); // public source, no credentials
 const composeConfig={services:{postgres:{image:'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24',
  environment:{POSTGRES_DB:'shadowbridge',POSTGRES_USER:'postgres',POSTGRES_PASSWORD:secrets.postgres,SB_AUTH_PASSWORD:secrets.auth,SB_API_PASSWORD:secrets.api,SB_SESSION_PASSWORD:secrets.sessions},
  ports:['127.0.0.1::5432'],volumes:[`${path.join(directory,'bootstrap.sh')}:/docker-entrypoint-initdb.d/10-sb.sh:ro`],
  networks:['private'],healthcheck:{test:['CMD-SHELL','pg_isready -U postgres -d shadowbridge'],interval:'1s',timeout:'3s',retries:60}},
 auth:{image:'supabase/gotrue:v2.184.0@sha256:c485010238ab429edf4ac8eb70b37b41aae0a0905277a935d4a0b64bb848e393',
  ports:['127.0.0.1::9999'],networks:['private'],depends_on:{postgres:{condition:'service_healthy'}},
  environment:{GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1',GOTRUE_SITE_URL:'http://127.0.0.1',
   GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${secrets.auth}@postgres/shadowbridge?search_path=auth`,
   GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:secrets.jwt,GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_AUD:'authenticated',
   GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'1',
   GOTRUE_MFA_ENABLED:'true',GOTRUE_MFA_TOTP_ENROLL_ENABLED:'true',GOTRUE_MFA_TOTP_VERIFY_ENABLED:'true',GOTRUE_MFA_MAX_ENROLLED_FACTORS:'5',
   GOTRUE_RATE_LIMIT_TOKEN_REFRESH:'1000',GOTRUE_LOG_LEVEL:'warn'}}},networks:{private:{ipam:{config:[{subnet:`10.253.${parseInt(id.slice(0,2),16)}.0/24`}]}}}};
 await writeFile(configPath,JSON.stringify(composeConfig)+'\n',{mode:0o600,flag:'wx'});
 compose(['up','-d','--wait','--wait-timeout','120']);
 const authOrigin='http://127.0.0.1:'+port('auth');
 for(let i=0;i<80;i++){try{if((await fetch(authOrigin+'/health')).ok)break;}catch{}if(i===79)throw new Error('GoTrue readiness failed');await new Promise(r=>setTimeout(r,250));}
 const connection=role=>`postgres://${role==='postgres'?'postgres':'shadowbridge_'+role}:${secrets[role]}@127.0.0.1:${port('postgres')}/shadowbridge`;
 admin=new pg.Client({connectionString:connection('postgres')});await admin.connect();
 // This is the V1 regression even when later additive migrations exist.
 const sources=(await migrationSources()).filter(s=>Number(s.name.slice(8,12))<=16);assert.equal(sources.length,16);
 for(const source of sources.slice(0,15))await admin.query(source.sql);
 await admin.query('CREATE SCHEMA shadowbridge_migrations;CREATE TABLE shadowbridge_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz DEFAULT now())');
 for(const source of sources.slice(0,15))await admin.query('INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES($1,$2)',[source.name,source.sha256]);
 const appPort=await freePort();process.env.SHADOWBRIDGE_TEST_URL='http://127.0.0.1:'+appPort;
 const config=loadConfig({APP_ENV:'test',APP_URL:process.env.SHADOWBRIDGE_TEST_URL,HOST:'127.0.0.1',PORT:String(appPort),SUPABASE_URL:authOrigin,SUPABASE_ANON_KEY:jwt('anon'),
  DATABASE_URL:connection('api'),SESSION_DATABASE_URL:connection('sessions'),SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),MAIL_DELIVERY_MODE:'disabled'});
 db=createDatabase({connectionString:config.databaseUrl,sessionConnectionString:config.sessionDatabaseUrl});app=createApp({config,db});await new Promise(r=>app.server.listen(appPort,'127.0.0.1',r));
 const h=await import('../server/tests/helpers.mjs');const actors={};
 await phase('isolated real GoTrue accounts, seven staff roles and original OWNER MFA established',async()=>{
  for(const role of ['owner','general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst','buyer','supplier','partner']){
   const actor={email:`${id}.${role}@test.shadowbridge.invalid`,password:credentials(),client:new h.Client()};
   // Explicit administrative creation is ONLY a fictional test fixture; it is
   // not a production registration or recovery path.
   const r=await fetch(authOrigin+'/admin/users',{method:'POST',headers:{Authorization:'Bearer '+jwt('service_role'),'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password,email_confirm:true})});assert.equal(r.status,200);
   actor.user=await r.json();actors[role]=actor;
   await actor.client.signIn(actor);
   if(['buyer','supplier','partner'].includes(role)){
    await db.asUser(actor.user,{aal:'aal1'},tx=>tx.query('SELECT sb.submit_application($1,$2::jsonb)',[role,JSON.stringify({legal_name:'FICTIONAL '+role,registration_number:'FICTIONAL-'+role,country:'NO'})]));
   }else{
    if(role==='owner')await admin.query('SELECT sb.bootstrap_owner($1::uuid)',[actor.user.id]);
    else {await admin.query('INSERT INTO sb.staff_grants(user_id,active) VALUES($1,true)',[actor.user.id]);await admin.query('INSERT INTO sb.staff_role_assignments(user_id,role_key,assigned_by) VALUES($1,$2,$3)',[actor.user.id,role,actors.owner.user.id]);}
    await h.enableMfa(actor);
   }
  }
  const applications=(await actors.owner.client.request('/api/admin/applications',{expected:200})).data.items;
  for(const role of ['buyer','supplier','partner']){
   const application=applications.find(a=>(a.user_id||a.userId)===actors[role].user.id);
   assert.ok(application,'Fictional company application must exist');
   await actors.owner.client.request('/api/admin/applications/'+application.id+'/decision',{method:'POST',body:{decision:'approved',reason:'FICTIONAL manual approval for isolated Vault role tests.'},expected:200});
   assert.ok((await actors[role].client.request('/api/session',{expected:200})).data.user.roles.includes(role));
  }
 });
 const before=await fingerprint(),migration=sources.at(-1);
 await phase('backup, collision refusal and migration 015→016 preserve accounts, sessions, roles and MFA',async()=>{
  const pgid=compose(['ps','-q','postgres']);
  const dump=execFileSync('docker',['--context','default','exec',pgid,'pg_dump','-U','postgres','-d','shadowbridge','-Fc'],{maxBuffer:20*1024*1024});
  await writeFile(path.join(directory,'before-016.dump'),dump,{mode:0o600,flag:'wx'});
  await admin.query('BEGIN;CREATE ROLE shadowbridge_vault_executor NOLOGIN');
  await denied(()=>admin.query(migration.sql.replace(/^([\s\S]*?)BEGIN;/,'$1').replace(/COMMIT;\s*$/,'')));
  await admin.query('ROLLBACK');assert.equal((await admin.query("SELECT count(*) FROM pg_roles WHERE rolname='shadowbridge_vault_executor'")).rows[0].count,'0');
  await admin.query(migration.sql.replace(/COMMIT;\s*$/,"INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES('"+migration.name+"','"+migration.sha256+"');COMMIT;"));
  assert.deepEqual(await fingerprint(),before);
  assert.equal((await admin.query('SELECT count(*) FROM shadowbridge_migrations.applied')).rows[0].count,'16');
 });
 const owner=actors.owner,base='/api/owner/vault';
 const intake=async(p)=>{const r=await owner.client.request(base+'/contacts',{method:'POST',body:{record:p,requestKey:randomUUID()},expected:201});return r.data.receipt;};
 await phase('real HTTP OWNER+MFA enforcement, all other roles denied, CSRF and private audit',async()=>{
  await new h.Client().request(base+'/statistics',{expected:401});
  for(const [role,actor] of Object.entries(actors))if(role!=='owner')await actor.client.request(base+'/statistics',{expected:403});
  const noMfa=new h.Client();await noMfa.signIn(owner);await noMfa.request(base+'/statistics',{expected:403});
  await owner.client.request(base+'/statistics',{expected:200});
  await owner.client.request(base+'/contacts',{method:'POST',body:{record:record(),requestKey:randomUUID()},csrf:false,expected:403});
  assert.ok(Number((await admin.query("SELECT count(*) FROM owner_vault.events WHERE action='access.denied'")).rows[0].count)>=10);
 });
 await phase('names and shared emails never merge people; strong keys deduplicate; conflicts require review',async()=>{
  await intake(record());await intake(record('two','TEST-2','other@fictional.invalid'));
  await intake(record('shared-a','TEST-1','info@fictional.invalid','shared'));
  await intake(record('shared-b','TEST-1','info@fictional.invalid','shared'));
  // Even a common mailbox wrongly labelled individual is not an identity key.
  await intake(record('generic-a','TEST-1','sales@fictional.invalid'));
  await intake(record('generic-b','TEST-1','sales@fictional.invalid'));
  await intake(record('same-email-new-source','TEST-1'));
  await intake(record('same-email-different-company','TEST-3'));
  await intake(record('profile','TEST-1','profile@fictional.invalid','individual','https://professional.invalid/alex'));
  await intake(record('conflict','TEST-1','alex@fictional.invalid','individual','https://professional.invalid/alex'));
  const changed=record();changed.contact.fullName='FICTIONAL Different Person';await intake(changed);
  const stats=(await owner.client.request(base+'/statistics',{expected:200})).data;
  assert.equal(stats.contacts,8);assert.equal(stats.companies,3);assert.equal(stats.duplicatesPrevented,1);assert.equal(stats.reviewRequired,2);
  assert.equal((await admin.query("SELECT count(*) FROM owner_vault.contacts WHERE verification_status<>'unconfirmed'")).rows[0].count,'0');
  assert.equal((await admin.query("SELECT count(*) FROM owner_vault.companies WHERE verification_status<>'unconfirmed'")).rows[0].count,'0');
 });
 await phase('bounded search, pages, manual review/version control and immutable private history',async()=>{
  const list=(await owner.client.request(base+'/contacts?limit=2&page=1&q=FICTIONAL',{expected:200})).data;assert.equal(list.items.length,2);assert.equal(list.total,8);
  await owner.client.request(base+'/contacts?limit=500',{expected:400});
  const contact=list.items[0];
  await owner.client.request(base+'/contacts/'+contact.id+'/review',{method:'POST',body:{status:'confirmed',version:contact.version,reason:'FICTIONAL documented independent human review.'},expected:200});
  await owner.client.request(base+'/contacts/'+contact.id+'/review',{method:'POST',body:{status:'confirmed',version:contact.version,reason:'FICTIONAL stale version must not overwrite review.'},expected:400});
  assert.equal((await admin.query("SELECT count(*) FROM owner_vault.companies WHERE verification_status<>'unconfirmed'")).rows[0].count,'0');
  assert.ok(Number((await admin.query("SELECT count(*) FROM owner_vault.events WHERE action='operation.failed'")).rows[0].count)>=2);
  await denied(()=>admin.query('UPDATE owner_vault.events SET action=action'));await denied(()=>admin.query('DELETE FROM owner_vault.intakes'));await denied(()=>admin.query('TRUNCATE owner_vault.events'));
 });
 await phase('FORCE RLS, raw table denial, non-owner impersonation attempts and Sentinel/policy isolation',async()=>{
  assert.equal((await admin.query("SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_vault' AND c.relkind='r'")).rows[0].ok,true);
  for(const actor of Object.values(actors))await denied(()=>db.asUser({...actor.user,mfaVerifiedAt:Math.floor(Date.now()/1000)},{aal:'aal2'},tx=>tx.query('SELECT * FROM owner_vault.contacts')));
  for(const role of ['shadowbridge_sentinel','shadowbridge_policy','shadowbridge_sessions','supabase_auth_admin']){
   await admin.query('BEGIN;SET LOCAL ROLE '+role);await denied(()=>admin.query('SELECT * FROM owner_vault.contacts'));await admin.query('ROLLBACK');
  }
  // Temporarily grant raw SELECT ONLY inside a rolled-back DBA test, so RLS
  // itself is tested separately from the normal audited-function-only ACL.
  await admin.query('BEGIN;GRANT SELECT ON owner_vault.contacts TO shadowbridge_api;'+claims(actors.general_director));
  assert.equal((await admin.query('SELECT count(*) FROM owner_vault.contacts')).rows[0].count,'0');
  await admin.query('RESET ROLE;'+claims(owner));assert.equal((await admin.query('SELECT count(*) FROM owner_vault.contacts')).rows[0].count,'8');await admin.query('ROLLBACK');
  await denied(()=>db.asUser({...actors.general_director.user,mfaVerifiedAt:Math.floor(Date.now()/1000)},{aal:'aal2'},tx=>tx.query('SELECT owner_vault.statistics()')));
  await denied(()=>db.asUser({...owner.user,mfaVerifiedAt:Math.floor(Date.now()/1000)-600},{aal:'aal2'},tx=>tx.query('SELECT owner_vault.owner_intake($1::jsonb,$2::uuid)',[JSON.stringify(record('stale')),randomUUID()])));
 });
 await phase('write-only agent binding, no match disclosure, retry safety, concurrency and rate limit',async()=>{
  const login='vault_fixture_'+id;
  await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT PASSWORD ${literal(secrets.worker)};GRANT shadowbridge_vault_ingest TO ${login};GRANT USAGE ON SCHEMA owner_vault TO ${login};GRANT EXECUTE ON FUNCTION owner_vault.ingest(jsonb,uuid) TO ${login}`);
  await admin.query('INSERT INTO owner_vault.agents(label,source_system,database_role,active,created_by) VALUES($1,$2,$3,true,$4)', ['FICTIONAL n8n','manual',login,owner.user.id]);
  worker=new pg.Pool({connectionString:`postgres://${login}:${secrets.worker}@127.0.0.1:${port('postgres')}/shadowbridge`,max:3});
  const p=JSON.stringify(record('agent','TEST-3','agent@fictional.invalid')),key=randomUUID();
  const first=(await worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid) AS receipt',[p,key])).rows[0];assert.deepEqual(Object.keys(first),['receipt']);
  assert.equal((await worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid) AS receipt',[p,key])).rows[0].receipt,first.receipt);
  await denied(()=>worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[JSON.stringify(record('other')),key]),'22023');
  await denied(()=>worker.query('SELECT * FROM owner_vault.contacts'));await denied(()=>worker.query('SELECT owner_vault.statistics()'));
  await worker.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal','aal2',false)",[owner.user.id]);
  await denied(()=>worker.query('SELECT owner_vault.read_records(\'contacts\')'));
  const wrong=record('wrong-source');wrong.source.system='apollo';await denied(()=>worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[JSON.stringify(wrong),randomUUID()]));
  const unsafe=record('unsafe');unsafe.contact.verificationStatus='confirmed';await denied(()=>worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[JSON.stringify(unsafe),randomUUID()]),'22023');
  const race=JSON.stringify(record('concurrent','TEST-4','race@fictional.invalid'));
  await Promise.all([randomUUID(),randomUUID()].map(k=>worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[race,k])));
  assert.equal((await admin.query("SELECT count(*) FROM owner_vault.contacts WHERE source_record_id='concurrent'")).rows[0].count,'1');
  const count=Number((await admin.query('SELECT count(*) FROM owner_vault.intakes WHERE agent_id IS NOT NULL')).rows[0].count);
  for(let i=count;i<60;i++)await worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[p,randomUUID()]);
  await denied(()=>worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[p,randomUUID()]),'54000');
  await admin.query('UPDATE owner_vault.agents SET active=false');await denied(()=>worker.query('SELECT owner_vault.ingest($1::jsonb,$2::uuid)',[p,randomUUID()]));
 });
 await phase('real counters and Europe/Oslo overnight boundaries include both DST changes',async()=>{
  const asOwner=fn=>db.asUser({...owner.user,mfaVerifiedAt:Math.floor(Date.now()/1000)},{aal:'aal2'},fn);
  for(const [at,hours] of [['2026-03-29T10:00:00Z',13],['2026-10-25T10:00:00Z',15]]){
   const s=(await asOwner(tx=>tx.query('SELECT owner_vault.statistics($1::timestamptz) AS s',[at]))).rows[0].s;
   assert.equal((Date.parse(s.overnight.end)-Date.parse(s.overnight.start))/3600000,hours);assert.equal(s.overnight.timezone,'Europe/Oslo');
  }
  const early=(await asOwner(tx=>tx.query("SELECT owner_vault.statistics('2026-10-22T04:00:00Z') AS s"))).rows[0].s;
  assert.equal(early.overnight.end,'2026-10-21T06:00:00+00:00');
  await admin.query("UPDATE owner_vault.contacts SET created_at='2026-10-21T20:00:00Z' WHERE id=(SELECT id FROM owner_vault.contacts ORDER BY id LIMIT 1)");
  const s=(await asOwner(tx=>tx.query("SELECT owner_vault.statistics('2026-10-22T10:00:00Z') AS s"))).rows[0].s;assert.equal(s.newContactsOvernight,1);
 });
 await phase('no CRM details in staff overview/audit; original sessions and OWNER factor still valid',async()=>{
  const overview=await owner.client.request('/api/staff/overview',{expected:200});assert.ok(!JSON.stringify(overview.data).includes('fictional.invalid'));
  assert.equal((await admin.query("SELECT count(*) FROM sb.audit_events WHERE resource LIKE 'owner_vault.%'")).rows[0].count,'0');
  const events=(await admin.query('SELECT * FROM owner_vault.events')).rows;assert.ok(events.some(e=>e.action==='contact.reviewed'));assert.ok(!JSON.stringify(events).includes('fictional.invalid'));
  const mfa=(await admin.query('SELECT id FROM auth.mfa_factors WHERE user_id=$1 AND status=\'verified\'',[owner.user.id])).rows;assert.equal(mfa[0].id,owner.factorId);
  for(const actor of Object.values(actors))assert.equal((await actor.client.request('/api/session',{expected:200})).data.user.id,actor.user.id);
 });
 if(process.env.SHADOWBRIDGE_TEST_VAULT_V2==='1') {
  result.kind='real-owner-vault-v2';
  await (await import('./owner-vault-v2.cases.mjs')).runWorkspaceTests({root,directory,compose,admin,db,actors,h,phase,result,record,intake,fingerprint,denied});
 }
 result.result='PASS';
} catch(error){result.result='FAIL';result.failedCase=current;result.errorType=error.name;await writeFile(path.join(directory,'failure.json'),JSON.stringify({phase:current,message:error.message,stack:error.stack})+'\n',{mode:0o600});console.error('FAIL: '+current+' ('+error.name+'); private diagnostics retained.');process.exitCode=1;}
finally {
 if(app)await app.close();else if(db)await db.close();if(worker)await worker.end();if(admin)await admin.end();
 try{compose(['stop']);result.fixtureStopped=true;}catch{result.fixtureStopped=false;process.exitCode=1;}
 const after=docker(['ps','--format','{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort();assert.deepEqual(after,beforeExisting);
 result.existingRunningContainersPreserved=true;result.finishedAt=new Date().toISOString();
 await writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 await writeFile('/tmp/shadowbridge-owner-vault-results.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
}
