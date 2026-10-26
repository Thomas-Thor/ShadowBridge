// Real images/Compose/PostgreSQL in the retained, explicitly isolated lab.
// Not a Contabo/ChatGPT/interactive GoTrue test; no production guard bypass.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {appOnlyFlow,acceptedBase,targetRelease,composeSwapArguments,backupOnlineDatabase,verifyOnlineDatabase,canonicalMounts} from '../scripts/book-oauth-app-only.mjs';
import {decryptArchive,encryptArchive} from '../scripts/staging-backup.mjs';
import {inspectSpace} from '../scripts/workspace-space.mjs';
import {assertApplicationOnly} from '../scripts/international-r1.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
const root='/tmp/shadowbridge-r1-isolated';assert.ok(process.cwd().startsWith(root+'/'));assert.equal((await inspectSpace({dockerRoot:root+'/overlay-data'})).result,'PASS');
assert.ok(process.env.PATH.startsWith(root+'/app-only-bin:'));
const docker=(args,opt={})=>execFileSync('docker',['--context','default',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024**2,...opt}).trim();
const build=JSON.parse(await readFile('.local/app-only-build/results.json','utf8'));assert.equal(build.result,'PASS');
const tag=randomBytes(4).toString('hex'),db='app_only_test_'+tag,restored='app_only_restore_'+tag,source='write_native_b7f8cac1';
const folder=path.join(process.cwd(),'.local','app-only-native-'+tag);await mkdir(folder,{mode:0o700});
const pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1',pgId=JSON.parse(docker(['inspect',pg]))[0].Id;
const sql=(d,q)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',d],{input:q}),lit=v=>"'"+String(v).replaceAll("'","''")+"'",hash=v=>createHash('sha256').update(v).digest('hex');
const identities=()=>JSON.parse(docker(['inspect',pg])).map(c=>({id:c.Id,image:c.Image,environment:hash(JSON.stringify(c.Config.Env)),mounts:canonicalMounts(c.Mounts)}));
const ledger=d=>sql(d,'SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t');
const fingerprint=d=>sql(d,"SELECT json_object_agg(k,v ORDER BY k) FROM ("+['auth.users','auth.mfa_factors','sb.accounts','sb.sessions'].map(t=>'SELECT '+lit(t)+" AS k,md5(coalesce(string_agg(value,',' ORDER BY value),'')) AS v FROM(SELECT to_jsonb(t)::text AS value FROM "+t+' t)x').join(' UNION ALL ')+')z');
const originalSource=fingerprint(source),originalLedger=ledger(source),protectedPg=identities();assert.equal(JSON.parse(originalLedger).length,21);
const template=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-app-1']))[0],project='shadowbridge-stageg-apponly-'+tag;
const composeFile=path.join(folder,'compose.json'),override=path.join(folder,'application.json'),rollback=path.join(folder,'rollback.json');
const env=template.Config.Env.filter(v=>!/^OWNER_BOOK_(API|MCP|OAUTH|MCP_CREATE|MCP_WRITE)_ENABLED=/.test(v)).map(v=>{
 const i=v.indexOf('='),key=v.slice(0,i);if(['DATABASE_URL','SESSION_DATABASE_URL'].includes(key)){const u=new URL(v.slice(i+1));assert.equal(u.searchParams.get('sslmode'),'verify-full');assert.ok(['shadowbridge_api','shadowbridge_sessions'].includes(u.username));u.pathname='/'+db;return key+'='+u.href;}return key==='RELEASE_SHA'?'RELEASE_SHA='+acceptedBase:v;
});env.push('OWNER_BOOK_API_ENABLED=true','OWNER_BOOK_MCP_ENABLED=true','OWNER_BOOK_OAUTH_ENABLED=true','OWNER_BOOK_MCP_CREATE_ENABLED=true','OWNER_BOOK_MCP_WRITE_ENABLED=true');
await writeFile(path.join(folder,'app.env'),env.join('\n')+'\n',{mode:0o600});
const network=Object.keys(template.NetworkSettings.Networks)[0];assert.match(network,/^shadowbridge-stageg-r1full-/);
const config={services:{app:{image:build.images[acceptedBase],env_file:path.join(folder,'app.env'),networks:['private'],volumes:template.Mounts.map(m=>{assert.equal(m.RW,false);return{type:'bind',source:m.Source,target:m.Destination,read_only:true};}),read_only:true,tmpfs:['/tmp'],cap_drop:['ALL'],security_opt:['no-new-privileges:true'],healthcheck:{test:['CMD','node','-e',"fetch('http://127.0.0.1:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],interval:'1s',timeout:'5s',retries:40}}},networks:{private:{external:true,name:network}}};
await writeFile(composeFile,JSON.stringify(config),{mode:0o600});
for(const[file,release]of [[override,targetRelease],[rollback,acceptedBase]])await writeFile(file,JSON.stringify({services:{app:{image:build.images[release],environment:{RELEASE_SHA:release}}}}),{mode:0o600});
const baseArgs=['compose','--project-name',project,'-f',composeFile],compose=args=>docker([...baseArgs,...args]);
const current=()=>{const id=compose(['ps','--all','-q','app']);return JSON.parse(docker(['inspect',id]))[0];};
const request=(route,options={})=>JSON.parse(docker(['exec','-i',current().Id,'node','--input-type=module','-e',"let s='';for await(const b of process.stdin)s+=b;const p=JSON.parse(s),r=await fetch('http://127.0.0.1:8088'+p.route,p.options);console.log(JSON.stringify({status:r.status,body:await r.json()}));"],{input:JSON.stringify({route,options})}));
let access,state,swaps=0,forceHealthFailure=false,writeAfterUpdate,originalApp;
const report={kind:'book-oauth-app-only-native',productionChanges:false,productionGuardBypassed:false,interactiveGoTrueTested:false,chatgptTested:false,actualOffsiteHostTested:false,images:build.images,migrationsExecuted:0,cases:[]};
const phase=async(name,fn)=>{await fn();report.cases.push({name,result:'PASS'});console.log('PASS '+name);};
const mcp=(name,args={})=>request('/api/integrations/owner-book/v1/mcp',{method:'POST',headers:{Authorization:'Bearer '+access,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:name==='tools/list'?'tools/list':'tools/call',params:name==='tools/list'?{}:{name,arguments:args}})});
const beforeTables=()=>{assert.equal(fingerprint(db),originalSource);assert.equal(ledger(db),originalLedger);assert.deepEqual(identities(),protectedPg);};
const ops={
 load:async()=>state&&structuredClone(state),save:async s=>{state=structuredClone(s);await writeFile(path.join(folder,'state.json'),JSON.stringify(s),{mode:0o600});},
 preflight:async()=>{assert.equal(current().Image,build.images[acceptedBase]);beforeTables();return{release:targetRelease,previousRelease:acceptedBase};},
 build:async()=>{for(const r of [acceptedBase,targetRelease])assert.equal(JSON.parse(docker(['image','inspect',build.images[r]]))[0].Config.Labels['org.opencontainers.image.revision'],r);},
 backup:async s=>{s.backup=await backupOnlineDatabase(pgId,path.join(folder,'database'),db);},
 verifyBackups:async s=>{assert.equal((await verifyOnlineDatabase(pgId,s.backup)).archiveAuthenticated,true);},
 verifyOffsite:async s=>{assert.equal(report.localCopyChecksumVerified,true);},
 ownerMfa:async()=>{assert.equal(Number(sql(db,"SELECT count(*) FROM auth.mfa_factors WHERE status='verified'"))>0,true);},
 check:async()=>{beforeTables();const base=JSON.parse(compose(['config','--format','json']));for(const[file,release]of [[override,targetRelease],[rollback,acceptedBase]])assertApplicationOnly(base,JSON.parse(compose(['-f',file,'config','--format','json'])),{image:build.images[release],releaseSha:release});},
 alreadyRunningTarget:async()=>current().Image===build.images[targetRelease]&&current().State.Running,
 replace:async()=>{docker(composeSwapArguments(baseArgs,override));swaps++;},
 rollback:async()=>{docker(composeSwapArguments(baseArgs,rollback));},
 verify:async(s,old)=>{beforeTables();const c=current();assert.equal(c.Image,build.images[old?acceptedBase:targetRelease]);assert.deepEqual(c.HostConfig,originalApp.HostConfig);assert.deepEqual(canonicalMounts(c.Mounts),canonicalMounts(originalApp.Mounts));assert.deepEqual(Object.keys(c.NetworkSettings.Networks).sort(),Object.keys(originalApp.NetworkSettings.Networks).sort());assert.deepEqual(c.Config.Env.filter(v=>!v.startsWith('RELEASE_SHA=')).sort(),originalApp.Config.Env.filter(v=>!v.startsWith('RELEASE_SHA=')).sort());assert.equal(request('/health').status,200);const meta=request('/.well-known/oauth-authorization-server');assert.equal(meta.body.scopes_supported.some(x=>x.endsWith('.create')),old);const listed=mcp('tools/list');assert.equal(listed.status,200);assert.equal(listed.body.result.tools.some(t=>t.name==='create_note'),old);assert.ok(listed.body.result.tools.some(t=>t.name==='create_book_entry'));if(forceHealthFailure&&!old){forceHealthFailure=false;throw Error('FICTIONAL forced post-swap health failure');}}
};
try{
 await phase('clone only the retained fictional 21-migration fixture, without applying any migration',async()=>{sql('postgres','CREATE DATABASE '+db);const dump=execFileSync('docker',['--context','default','exec',pg,'pg_dump','-U','postgres','-Fc','-d',source],{maxBuffer:32*1024**2,stdio:['ignore','pipe','pipe']});docker(['exec','-i',pg,'pg_restore','--exit-on-error','-U','postgres','-d',db],{input:dump});beforeTables();});
 const owner=sql(db,"SELECT id FROM auth.users WHERE email='fictional-owner2-2db3cf7b@ownerbook.test.invalid'"),client='sboc_'+randomUUID(),resource='https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',redirect='https://chatgpt.com/connector_platform_oauth_redirect',clientHash=hash(tag),codeHash=hash(randomUUID());access='sboa_'+randomBytes(32).toString('base64url');
 const machine=(action,p)=>JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_sessions;SELECT owner_book.oauth_machine('+lit(action)+','+lit(JSON.stringify(p))+'::jsonb,'+lit(clientHash)+','+lit(randomUUID())+'::uuid);'));
 assert.equal(machine('register',{id:client,name:'FICTIONAL app-only acceptance',redirects:[redirect],auth_method:'none',secret_hash:null}).status,200);
 const granted=JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(owner)+';SET LOCAL "request.jwt.claim.aal"=\'aal2\';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)))+';SELECT owner_book.oauth_owner(\'authorize\','+lit(JSON.stringify({client_id:client,redirect_uri:redirect,resource,scopes:['note.read','note.write','task.read','task.write'],challenge:'c'.repeat(43),code_hash:codeHash,flow_hash:hash(randomUUID()),explicitWriteConsent:true}))+'::jsonb,'+lit(randomUUID())+'::uuid);COMMIT;'));
 assert.equal(granted.status,200);assert.equal(machine('token',{client_id:client,auth_method:'none',secret_hash:null,code_hash:codeHash,redirect_uri:redirect,resource,challenge:'c'.repeat(43),access_hash:hash(access),next_refresh_hash:hash(randomUUID())}).status,200);
 docker(composeSwapArguments(baseArgs,rollback));originalApp=current();
 await phase('same coordinator prepares an encrypted online pg_dump without stopping other containers; authenticated restore preserves all protected tables',async()=>{
  await appOnlyFlow(ops,'prepare');assert.equal(state.phase,'BACKUPS_VERIFIED_WAITING_OFFSITE');
  const local=path.join(folder,'simulated-owner-copy.sbb');await writeFile(local,await readFile(state.backup.backupFile),{mode:0o600});report.localCopyChecksumVerified=hash(await readFile(local))===hash(await readFile(state.backup.backupFile));
  const dump=path.join(folder,'verified-restore.dump');await decryptArchive({...state.backup,archiveFile:dump});sql('postgres','CREATE DATABASE '+restored);docker(['exec','-i',pg,'pg_restore','--exit-on-error','-U','postgres','-d',restored],{input:await readFile(dump)});await unlink(dump);assert.equal(fingerprint(restored),originalSource);assert.equal(ledger(restored),originalLedger);
 });
 await phase('real Compose APP-ONLY swap reaches e871f2e, separates authenticated discovery and preserves PostgreSQL/MFA/ledger',async()=>{await appOnlyFlow(ops,'apply');assert.equal(state.phase,'DEPLOYED_PENDING_OWNER_ACCEPTANCE');assert.equal(swaps,1);});
 await phase('actual MCP write is persisted after backup and survives an app-only rollback to the real 80f4a0d image',async()=>{
  const result=mcp('create_book_entry',{entry:{kind:'note',title:'FICTIONAL app-only rollback '+tag,body:'Retain this post-backup record'},requestKey:randomUUID(),explicitWrite:true});assert.equal(result.status,200);assert.equal(result.body.result.isError,false);writeAfterUpdate=result.body.result.structuredContent;
  await appOnlyFlow(ops,'rollback');assert.equal(state.phase,'ROLLED_BACK_APPLICATION_ONLY');assert.equal(sql(db,'SELECT body FROM owner_book.entries WHERE id='+lit(writeAfterUpdate.id)),'Retain this post-backup record');assert.ok(mcp('read_notes',{q:tag}).body.result.structuredContent.items.some(e=>e.id===writeAfterUpdate.id));beforeTables();
 });
 await phase('forced new-image health failure triggers the actual previous-image Compose rollback, without restoring the DB',async()=>{state.phase='BACKUPS_VERIFIED_WAITING_OFFSITE';forceHealthFailure=true;await assert.rejects(appOnlyFlow(ops,'apply'),/APPLICATION_ROLLED_BACK/);assert.equal(state.phase,'ROLLED_BACK_APPLICATION_ONLY');assert.equal(sql(db,'SELECT count(*) FROM owner_book.entries WHERE id='+lit(writeAfterUpdate.id)),'1');});
 await phase('interrupted checkpoint with target already running resumes verification without another image replacement; OWNER acceptance is separate',async()=>{
  docker(composeSwapArguments(baseArgs,override));state.phase='SWAPPING_APP';const count=swaps;await appOnlyFlow(ops,'resume');assert.equal(swaps,count);await appOnlyFlow(ops,'accept');assert.equal(state.phase,'DEPLOYED_AND_VERIFIED');await appOnlyFlow(ops,'verify');beforeTables();
 });
 await phase('GCM corruption fails before swap; original fixture and all initial users, sessions, factors and migration hashes remain unchanged',async()=>{
  const bad=path.join(folder,'tampered.sbb'),bytes=Buffer.from(await readFile(state.backup.backupFile));bytes[bytes.length-1]^=1;await writeFile(bad,bytes,{mode:0o600});await assert.rejects(verifyOnlineDatabase(pgId,{backupFile:bad,keyFile:state.backup.keyFile}));beforeTables();assert.equal(fingerprint(source),originalSource);assert.equal(ledger(source),originalLedger);
 });
 report.result='PASS';report.databaseRetained=db;report.restoreDatabaseRetained=restored;
}catch(e){report.result='FAIL';report.error='See private test exception; no production action';throw e;}finally{
 try{compose(['stop','app']);}catch{}
 await writeFile(path.join(folder,'results.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+folder);
}
