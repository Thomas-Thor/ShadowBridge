// Built app + real TLS PostgreSQL + encrypted dump/restore. Consent identity uses
// explicit fictional SQL OWNER/MFA claims; not a GoTrue or ChatGPT acceptance.
import assert from'node:assert/strict';import{execFileSync}from'node:child_process';
import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash,randomBytes,randomUUID}from'node:crypto';
import{encryptArchive,decryptArchive}from'../scripts/staging-backup.mjs';import{inspectSpace}from'../scripts/workspace-space.mjs';
import{migrationSources,validateApplied}from'../scripts/staging-migrate.mjs';
import{pinnedR1Runtime,ownerBookMcpR1}from'../scripts/international-r1-diagnose.mjs';
import{repositoryRoot}from'../scripts/staging-prepare.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
const revision=process.argv.find(s=>s.startsWith('--build='))?.slice(8);assert.match(revision||'',/^[a-f0-9]{40}$/);
const base='/tmp/shadowbridge-r1-isolated';assert.equal((await inspectSpace({directory:base,dockerRoot:base+'/overlay-data'})).result,'PASS');
const D=['exec','-i','shadowbridge-r1-isolated-daemon-20261024','docker','--host','unix://'+base+'/overlay.sock'];
const docker=(args,opts={})=>execFileSync('docker',[...D,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024**2,...opts});
const pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1',source='owner_book_test_2db3cf7b',tag=randomBytes(4).toString('hex'),db='oauth_native_'+tag,dir=new URL('../.local/oauth-runtime-'+tag+'/',import.meta.url);
await mkdir(dir,{mode:0o700});const lit=v=>"'"+String(v).replaceAll("'","''")+"'",hash=v=>createHash('sha256').update(v).digest('hex');
const sql=(database,q)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:q}).trim();
const build=JSON.parse(await readFile(new URL('../.local/oauth-native-build-'+revision.slice(0,12)+'/results.json',import.meta.url)));assert.equal(build.result,'PASS');assert.equal(build.sourceSha,revision);
const result={kind:'native-oauth-real-postgresql-backup-rollback',sourceSha:revision,images:build.images,productionChanges:false,interactiveGoTrueLoginTested:false,chatgptConnected:false,cases:[]};let active;
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});console.log('PASS '+name);};
const fingerprints=database=>{
 const tables=sql(database,"SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('sb','auth','owner_book','owner_vault') ORDER BY 1").split('\n');assert.ok(tables.length>20);
 const parts=tables.map(t=>{assert.match(t,/^[a-z_]+\.[a-z_]+$/);return 'SELECT '+lit(t)+" AS k,md5(coalesce(string_agg(value,',' ORDER BY value),'')) AS v FROM(SELECT to_jsonb(t)::text AS value FROM "+t+' t)a';});
 return JSON.parse(sql(database,'SELECT json_object_agg(k,v) FROM('+parts.join(' UNION ALL ')+')x'));
};
const template=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-app-1']))[0];
const request=(path,options={})=>JSON.parse(docker(['exec','-i',active,'node','--input-type=module','-e',"let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s),r=await fetch('http://127.0.0.1:8088'+p.path,p.options),t=await r.text();let body;try{body=JSON.parse(t)}catch{body=t}console.log(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body}));"],{input:JSON.stringify({path,options})}));
const start=async({image=build.images.runtime,oauth=true,release=revision}={})=>{
 active='shadowbridge-oauth-native-'+tag+'-'+String(oauth)+'-'+release.slice(0,6);
 const env=template.Config.Env.filter(v=>!/^OWNER_BOOK_(API|MCP|OAUTH)_ENABLED=/.test(v)).map(v=>{const i=v.indexOf('='),k=v.slice(0,i);if(['DATABASE_URL','SESSION_DATABASE_URL'].includes(k)){const u=new URL(v.slice(i+1));assert.equal(u.searchParams.get('sslmode'),'verify-full');assert.ok(['shadowbridge_api','shadowbridge_sessions'].includes(u.username));u.pathname='/'+db;return k+'='+u.href;}return k==='RELEASE_SHA'?'RELEASE_SHA='+release:v;});env.push('OWNER_BOOK_API_ENABLED=true','OWNER_BOOK_MCP_ENABLED=true','OWNER_BOOK_OAUTH_ENABLED='+String(oauth));
 const envFile=new URL(active+'.env',dir).pathname;await writeFile(envFile,env.join('\n')+'\n',{mode:0o600});const network=Object.keys(template.NetworkSettings.Networks)[0];assert.match(network,/^shadowbridge-stageg-r1full-/);
 const args=['run','-d','--name',active,'--network',network,'--env-file',envFile];for(const m of template.Mounts){assert.equal(m.Type,'bind');assert.equal(m.RW,false);args.push('--mount','type=bind,source='+m.Source+',target='+m.Destination+',readonly');}args.push(image);docker(args);
 for(let i=0;i<100;i++){try{if(request('/health').status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Native app did not become healthy');
};
const stop=()=>{if(active){docker(['stop',active]);active=null;}};
try{
 const before=fingerprints(source),dump=docker(['exec',pg,'pg_dump','-U','postgres','-Fc','-d',source],{encoding:null}),dumpFile=new URL('before.dump',dir).pathname;
 await writeFile(dumpFile,dump,{mode:0o600});const backup=await encryptArchive({archiveFile:dumpFile,backupFile:new URL('before.sbb',dir).pathname,keyFile:new URL('before.key',dir).pathname});
 await phase('authenticated encrypted PostgreSQL backup restores to a new database with every original table unchanged',async()=>{
  const restored=new URL('restored.dump',dir).pathname;await decryptArchive({...backup,archiveFile:restored});assert.equal(hash(await readFile(restored)),hash(dump));sql('postgres','CREATE DATABASE '+db);docker(['exec','-i',pg,'pg_restore','--exit-on-error','-U','postgres','-d',db],{input:await readFile(restored)});assert.deepEqual(fingerprints(db),before);result.encryptedBackupRestored=true;
 });
 const sources=await migrationSources();assert.equal(sources.length,19);
 await phase('only missing additive 019 is tracked; original rows and hashes remain intact, second pass has zero pending migrations',async()=>{
  const applied=JSON.parse(sql(db,'SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));validateApplied(sources,applied);assert.equal(applied.length,18);const m=sources[18];assert.equal(m.name,'202610250019_owner_book_oauth.sql');const tracked=m.sql.replaceAll('shadowbridge_book_executor','sb_book_executor_2db3cf7b').replace(/COMMIT\s*;\s*$/i,'INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES('+lit(m.name)+','+lit(m.sha256)+');COMMIT;');sql(db,tracked);result.fixtureExecutorRoleSubstitution=true;const after=fingerprints(db);for(const[k,v]of Object.entries(before))assert.equal(after[k],v,k);const ledger=JSON.parse(sql(db,'SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));validateApplied(sources,ledger);assert.equal(sources.slice(ledger.length).length,0);
 });
 const owner=sql(db,"SELECT id FROM auth.users WHERE email='fictional-owner-2db3cf7b@ownerbook.test.invalid'"),other=sql(db,"SELECT id FROM auth.users WHERE email='fictional-owner2-2db3cf7b@ownerbook.test.invalid'");
 const rpc=(user,fn,args)=>JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(user)+';SET LOCAL "request.jwt.claim.aal"=\'aal2\';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)))+';SELECT owner_book.'+fn+'('+args+');COMMIT;'));
 const note=rpc(owner,'owner_rpc',"'save','note',"+lit(JSON.stringify({kind:'note',title:'FICTIONAL OAUTH '+tag,body:'A real persisted fictional note for MCP OAuth acceptance.'}))+'::jsonb,'+lit(randomUUID())+'::uuid,'+lit(randomUUID())+'::uuid');assert.equal(note.status,200);
 const raw='sbob_'+randomBytes(32).toString('base64url'),key=rpc(owner,'owner_rpc',"'key_create',NULL,"+lit(JSON.stringify({name:'FICTIONAL original REST',mode:'read_only',scopes:['note.read'],expiresAt:new Date(Date.now()+3600000).toISOString(),tokenHash:hash(raw)}))+'::jsonb,'+lit(randomUUID())+'::uuid,NULL');assert.equal(key.status,200);
 const rest=()=>request('/api/integrations/owner-book/v1/entries?kind=note',{headers:{Authorization:'Bearer '+raw}});
 const mcp=(token,method,params={})=>request('/api/integrations/owner-book/v1/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 await phase('non-root built image with OAuth off preserves the existing REST and MCP bearer paths',async()=>{await start({oauth:false});assert.equal(JSON.parse(docker(['inspect',active]))[0].Config.User,'node');assert.equal(request('/.well-known/oauth-authorization-server').status,503);assert.equal(rest().status,200);assert.equal(mcp(raw,'tools/list').status,200);stop();});
 const resource='https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',redirect='https://chatgpt.com/connector_platform_oauth_redirect',verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');let access,refresh,clientId;
 const exchange=p=>request('/oauth/owner-book/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(p).toString()});
 await phase('real image discovers OAuth, registers a PKCE client and reads the persisted note through actual restricted TLS PostgreSQL',async()=>{
  await start();assert.equal(request('/.well-known/oauth-protected-resource').body.resource,resource);const meta=request('/.well-known/oauth-authorization-server');assert.equal(meta.status,200);assert.ok(meta.body.code_challenge_methods_supported.includes('S256'));
  const reg=request('/oauth/owner-book/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'FICTIONAL native OAuth',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(reg.status,201);clientId=reg.body.client_id;
  const params=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,resource,scope:'note.read',state:randomBytes(24).toString('base64url'),code_challenge:challenge,code_challenge_method:'S256'});const page=request('/oauth/owner-book/authorize?'+params);assert.equal(page.status,200);assert.match(page.headers['set-cookie'],/HttpOnly/);assert.equal(request('/oauth/owner-book/context').status,403);
  const code='sbocc_'+randomBytes(32).toString('base64url'),p={client_id:clientId,redirect_uri:redirect,resource,scopes:['note.read'],challenge,code_hash:hash(code),flow_hash:hash(randomUUID())};assert.equal(rpc(owner,'oauth_owner',"'authorize',"+lit(JSON.stringify(p))+'::jsonb,'+lit(randomUUID())+'::uuid').status,200);
  assert.equal(exchange({client_id:clientId,grant_type:'authorization_code',code,redirect_uri:redirect,resource,code_verifier:'x'.repeat(43)}).status,400);
  const issued=exchange({client_id:clientId,grant_type:'authorization_code',code,redirect_uri:redirect,resource,code_verifier:verifier});assert.equal(issued.status,200);access=issued.body.access_token;refresh=issued.body.refresh_token;
  const initialized=mcp(access,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'FICTIONAL native client',version:'1'}});assert.equal(initialized.status,200);assert.equal(initialized.body.result.protocolVersion,'2025-11-25');
  const notes=mcp(access,'tools/call',{name:'read_notes',arguments:{q:'FICTIONAL OAUTH '+tag}});assert.equal(notes.status,200);assert.deepEqual(notes.body.result.structuredContent.items.map(x=>x.id),[note.data.id]);assert.ok(!JSON.stringify(notes.body).includes(owner));assert.equal(mcp(access,'tools/call',{name:'read_book_entries',arguments:{kind:'task'}}).status,403);assert.equal(mcp(access,'tools/call',{name:'create_note'}).body.error.code,-32602);
  assert.equal(request('/api/integrations/owner-book/v1/entries?kind=note',{headers:{Authorization:'Bearer '+access}}).status,401);assert.equal(sql(db,"SELECT bool_and(ssl) FROM pg_stat_ssl JOIN pg_stat_activity USING(pid) WHERE datname="+lit(db)+" AND usename IN ('shadowbridge_api','shadowbridge_sessions') AND backend_type='client backend'"),'t');
 });
 await phase('confidential dynamic registration and Basic client authentication reject wrong secrets and revoke via the standard endpoint',async()=>{
  const reg=request('/oauth/owner-book/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'FICTIONAL native confidential',redirect_uris:[redirect],token_endpoint_auth_method:'client_secret_basic'})});assert.equal(reg.status,201);const id=reg.body.client_id,secret=reg.body.client_secret;assert.ok(secret);
  const code='sbocc_'+randomBytes(32).toString('base64url');assert.equal(rpc(owner,'oauth_owner',"'authorize',"+lit(JSON.stringify({client_id:id,redirect_uri:redirect,resource,scopes:['note.read'],challenge,code_hash:hash(code),flow_hash:hash(randomUUID())}))+'::jsonb,'+lit(randomUUID())+'::uuid').status,200);
  const token=(secretValue,path='/token',p={grant_type:'authorization_code',code,redirect_uri:redirect,resource,code_verifier:verifier})=>request('/oauth/owner-book'+path,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(encodeURIComponent(id)+':'+encodeURIComponent(secretValue)).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(p).toString()});
  assert.equal(token('FICTIONAL wrong secret').status,401);const issued=token(secret);assert.equal(issued.status,200);assert.equal(mcp(issued.body.access_token,'tools/call',{name:'read_notes'}).status,200);assert.equal(token(secret,'/revoke',{token:issued.body.refresh_token}).status,200);assert.equal(mcp(issued.body.access_token,'tools/call',{name:'read_notes'}).status,401);
 });
 await phase('real refresh rotation, restart persistence and owner revocation deny stale tokens without changing REST',async()=>{
  const next=exchange({client_id:clientId,grant_type:'refresh_token',refresh_token:refresh,resource});assert.equal(next.status,200);access=next.body.access_token;
  docker(['restart',active]);for(let i=0;i<100;i++){try{if(request('/health').status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(mcp(access,'tools/call',{name:'read_notes',arguments:{q:'FICTIONAL OAUTH '+tag}}).status,200);assert.equal(rest().status,200);
  const grants=rpc(owner,'oauth_owner',"'connections','{}',"+lit(randomUUID())+'::uuid');assert.equal(grants.status,200);const grant=grants.data.items.find(g=>g.name==='FICTIONAL native OAuth');assert.ok(grant);assert.equal(rpc(other,'oauth_owner',"'revoke',"+lit(JSON.stringify({id:grant.id}))+'::jsonb,'+lit(randomUUID())+'::uuid').status,403);assert.equal(rpc(owner,'oauth_owner',"'revoke',"+lit(JSON.stringify({id:grant.id}))+'::jsonb,'+lit(randomUUID())+'::uuid').status,200);assert.equal(mcp(access,'tools/call',{name:'read_notes'}).status,401);assert.equal(rest().status,200);stop();
 });
 await phase('old native MCP image remains compatible after 019: application-only rollback retains notes, REST, roles, sessions and MFA',async()=>{
  const old=JSON.parse(await readFile(new URL('../.local/mcp-native-build-9192b868cba4/results.json',import.meta.url)));assert.equal(old.result,'PASS');result.rollbackCompatibilityImage=old.imageId;result.rollbackCompatibilitySource=old.sourceSha;await start({image:old.imageId,oauth:false,release:old.sourceSha});
  const expected=await pinnedR1Runtime(repositoryRoot,ownerBookMcpR1),lines=docker(['exec',active,'sha256sum',...Object.keys(expected).map(f=>'/app/'+f)]).trim().split('\n');assert.equal(lines.length,68);for(const line of lines){const[h,file]=line.split(/\s+/);assert.equal(h,expected[file.slice(5)]);}result.rollbackRuntimeMatches35c41f7=true;
  assert.equal(rest().status,200);const noteRead=mcp(raw,'tools/call',{name:'read_notes',arguments:{q:'FICTIONAL OAUTH '+tag}});assert.equal(noteRead.status,200);assert.equal(noteRead.body.result.structuredContent.items[0].id,note.data.id);assert.equal(sql(db,'SELECT count(*) FROM owner_book.oauth_grants'),'2');
  const after=fingerprints(db);for(const key of ['auth.users','auth.mfa_factors','sb.sessions','sb.accounts','sb.staff_grants','sb.staff_role_assignments'])assert.equal(after[key],before[key],key);assert.deepEqual(fingerprints(source),before);result.originalFixtureUnchanged=true;
 });
 result.result='PASS';
}catch(e){result.result='FAIL';await writeFile(new URL('failure.json',dir),JSON.stringify({message:e.message,stack:e.stack,stderr:String(e.stderr||'')})+'\n',{mode:0o600});console.error('FAIL; inspect private '+dir.pathname);process.exitCode=1;}
finally{stop();result.databaseRetained=db;result.testAppContainersStopped=true;await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
