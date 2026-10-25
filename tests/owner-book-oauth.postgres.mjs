// Explicit isolated SQL security test. Never uses a production database or user.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {inspectSpace} from '../scripts/workspace-space.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
const base='/tmp/shadowbridge-r1-isolated';
assert.equal((await inspectSpace({directory:base,dockerRoot:base+'/overlay-data'})).result,'PASS');
const D=['exec','-i','shadowbridge-r1-isolated-daemon-20261024','docker','--host','unix://'+base+'/overlay.sock'];
const docker=(a,o={})=>execFileSync('docker',[...D,...a],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024**2,...o}).trim();
const pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1',tag=randomBytes(4).toString('hex'),db='oauth_test_'+tag,dir=new URL('../.local/oauth-postgres-'+tag+'/',import.meta.url);
await mkdir(dir,{mode:0o700});
const sql=(database,q)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:q});
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",hash=s=>createHash('sha256').update(s).digest('hex'),clientHash=hash('FICTIONAL local test');
const source=JSON.parse(await readFile(new URL('../.local/owner-book-2db3cf7b/results.json',import.meta.url)));assert.equal(source.result,'PASS');assert.equal(source.databaseRetained,'owner_book_test_2db3cf7b');
const result={kind:'oauth-real-postgresql',productionAccess:false,interactiveGoTrueLoginTested:false,chatgptConnected:false,cases:[]};
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});console.log('PASS '+name);};
const preserve=database=>sql(database,"SELECT md5((SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'[]') FROM auth.users u)||(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id)::text,'[]') FROM auth.mfa_factors f)||(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id_hash)::text,'[]') FROM sb.sessions s))");
try{
 const original=preserve(source.databaseRetained);sql('postgres','CREATE DATABASE '+db+' TEMPLATE '+source.databaseRetained);
 const before=preserve(db),migration=await readFile(new URL('../supabase/migrations/202610250019_owner_book_oauth.sql',import.meta.url),'utf8');
 await phase('019 applies transactionally to a clone; source accounts, passwords, sessions and MFA remain unchanged',async()=>{sql(db,migration.replaceAll('shadowbridge_book_executor','sb_book_executor_2db3cf7b'));result.fixtureExecutorRoleSubstitution=true;assert.equal(preserve(db),before);assert.equal(sql(db,"SELECT count(*) FROM pg_tables WHERE schemaname='owner_book' AND tablename LIKE 'oauth_%' AND rowsecurity"),'5');});
 const owner=sql(db,"SELECT id FROM auth.users WHERE email='fictional-owner-2db3cf7b@ownerbook.test.invalid'"),other=sql(db,"SELECT id FROM auth.users WHERE email='fictional-owner2-2db3cf7b@ownerbook.test.invalid'");assert.match(owner,/^[a-f0-9-]{36}$/);
 const machine=(action,p)=>JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_sessions;SELECT owner_book.oauth_machine('+lit(action)+','+lit(JSON.stringify(p))+'::jsonb,'+lit(clientHash)+','+lit(randomUUID())+'::uuid);'));
 const browser=(subject,action,p={},aal='aal2',fresh=true)=>JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(subject)+';SET LOCAL "request.jwt.claim.aal"='+lit(aal)+';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)-(fresh?0:86400)))+';SELECT owner_book.oauth_owner('+lit(action)+','+lit(JSON.stringify(p))+'::jsonb,'+lit(randomUUID())+'::uuid);COMMIT;'));
 const id='sboc_'+randomUUID(),redirect='https://chatgpt.com/connector_platform_oauth_redirect',resource='https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const client={client_id:id,auth_method:'none',secret_hash:null};
 assert.equal(machine('register',{id,name:'FICTIONAL ChatGPT',redirects:[redirect],auth_method:'none',secret_hash:null}).status,200);
 const authorize=(subject=owner,scopes=['note.read'],overrides={})=>{const code=randomBytes(32).toString('base64url'),p={client_id:id,redirect_uri:redirect,resource,scopes,challenge,code_hash:hash(code),flow_hash:hash(randomUUID()),...overrides};return{code,p,r:browser(subject,'authorize',p)};};
 const exchange=(code,extra={})=>{const access='sboa_'+randomBytes(32).toString('base64url'),refresh='sbor_'+randomBytes(32).toString('base64url');return{access,refresh,r:machine('token',{...client,code_hash:hash(code),redirect_uri:redirect,resource,challenge,access_hash:hash(access),next_refresh_hash:hash(refresh),...extra})};};
 const read=(access,action='list',kind='note',extra={})=>machine('read',{token_hash:hash(access),resource,action,kind,params:{page:'1'},...extra});
 await phase('fresh real OWNER eligibility is required; non-owners, AAL1, stale MFA, write scopes and redirect changes are denied',async()=>{
  assert.equal(browser(owner,'context').status,200);assert.equal(browser(owner,'context',{},'aal1').status,403);assert.equal(browser(owner,'context',{},'aal2',false).status,403);
  const subjects=sql(db,"SELECT user_id FROM sb.accounts WHERE user_id NOT IN (SELECT user_id FROM sb.staff_role_assignments WHERE role_key='owner' AND active) AND user_id NOT IN ("+lit(owner)+','+lit(other)+") LIMIT 30").split('\n').filter(Boolean);assert.ok(subjects.length>0);for(const sub of subjects)assert.equal(browser(sub,'context').status,403);
  assert.equal(authorize(owner,['note.write']).r.status,403);assert.equal(authorize(owner,['note.read'],{redirect_uri:'https://attacker.invalid/'}).r.status,403);assert.equal(authorize(owner,['note.read'],{resource:null}).r.status,403);
 });
 let delegated;
 await phase('PKCE, resource, registered callback, one-use code and per-owner read isolation are enforced in PostgreSQL',async()=>{
  const a=authorize();assert.equal(a.r.status,200);assert.equal(browser(owner,'authorize',a.p).status,403);
  assert.equal(exchange(a.code,{challenge:'wrong'}).r.status,400);assert.equal(exchange(a.code,{resource:'https://attacker.invalid/'}).r.status,400);assert.equal(exchange(a.code,{resource:null}).r.status,400);assert.equal(exchange(a.code,{redirect_uri:'https://attacker.invalid/'}).r.status,400);
  delegated=exchange(a.code);assert.equal(delegated.r.status,200);assert.equal(read(delegated.access).status,200);assert.equal(read(delegated.access,'list','task').status,403);assert.equal(read(delegated.access,'save','note').status,403);assert.equal(read(delegated.access,'list','note',{resource:null}).status,401);
  const data=read(delegated.access).data;const owned=new Set(sql(db,'SELECT id FROM owner_book.entries WHERE owner_id='+lit(owner)).split('\n'));assert.ok(data.items.every(n=>owned.has(n.id)));
  assert.equal(exchange(a.code).r.status,400);assert.equal(read(delegated.access).status,401);
 });
 await phase('refresh rotation, replay family revocation, expiry, owner revocation and unchanged REST credentials are real',async()=>{
  const a=authorize(),one=exchange(a.code);assert.equal(one.r.status,200);
  const nextAccess='sboa_'+randomBytes(32).toString('base64url'),nextRefresh='sbor_'+randomBytes(32).toString('base64url');
  const p={...client,resource,refresh_hash:hash(one.refresh),access_hash:hash(nextAccess),next_refresh_hash:hash(nextRefresh)};
  assert.equal(machine('refresh',p).status,200);assert.equal(read(nextAccess).status,200);assert.equal(machine('refresh',p).status,400);assert.equal(read(nextAccess).status,401);
  const two=exchange(authorize().code);assert.equal(two.r.status,200);const grant=sql(db,'SELECT grant_id FROM owner_book.oauth_access WHERE digest='+lit(hash(two.access)));
  assert.equal(browser(other,'revoke',{id:grant}).status,403);assert.equal(browser(owner,'revoke',{id:grant}).status,200);assert.equal(read(two.access).status,401);
  const three=exchange(authorize().code);sql(db,"UPDATE owner_book.oauth_access SET expires_at=now()-interval '1 second' WHERE digest="+lit(hash(three.access)));assert.equal(read(three.access).status,401);
  const denied=JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_sessions;SELECT owner_book.token_rpc('+lit(hash(three.access))+",'list','note','{}',NULL,false,"+lit(clientHash)+','+lit(randomUUID())+'::uuid);'));assert.equal(denied.status,401);
 });
 await phase('RLS and function grants deny raw OAuth tables, unauthorized consent and cross-owner connection lists',async()=>{
  for(const role of ['shadowbridge_api','shadowbridge_sessions'])for(const table of ['oauth_clients','oauth_codes','oauth_grants','oauth_access','oauth_refresh'])assert.throws(()=>sql(db,'SET SESSION AUTHORIZATION '+role+';SELECT * FROM owner_book.'+table));
  assert.throws(()=>sql(db,"SET SESSION AUTHORIZATION shadowbridge_sessions;SELECT owner_book.oauth_owner('context','{}',gen_random_uuid())"));
  assert.throws(()=>sql(db,"SET SESSION AUTHORIZATION shadowbridge_api;SELECT owner_book.oauth_machine('client','{}',repeat('a',64),gen_random_uuid())"));
  assert.equal(browser(other,'connections').data.items.length,0);assert.ok(browser(owner,'connections').data.items.length>0);
 });
 await phase('delegation immediately fails when OWNER loses active verified MFA; restore only the fictional test transaction',async()=>{
  const four=exchange(authorize().code);assert.equal(read(four.access).status,200);
  const denied=sql(db,'BEGIN;UPDATE auth.mfa_factors SET status=\'unverified\' WHERE user_id='+lit(owner)+";SET LOCAL SESSION AUTHORIZATION shadowbridge_sessions;SELECT owner_book.oauth_machine('read',"+lit(JSON.stringify({token_hash:hash(four.access),resource,action:'list',kind:'note',params:{}}))+'::jsonb,'+lit(clientHash)+',gen_random_uuid());ROLLBACK;');assert.equal(JSON.parse(denied).status,401);
  assert.equal(preserve(db),before);assert.equal(preserve(source.databaseRetained),original);
 });
 result.result='PASS';
}catch(e){result.result='FAIL';await writeFile(new URL('failure.json',dir),JSON.stringify({message:e.message,stack:e.stack,stderr:String(e.stderr||'')})+'\n',{mode:0o600});console.error('FAIL; inspect private '+dir.pathname);process.exitCode=1;}
finally{result.databaseRetained=db;await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
