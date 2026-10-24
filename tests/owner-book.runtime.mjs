// Native built Node image + its real TLS PostgreSQL pools. Authentication
// claims used to issue/revoke the FICTIONAL key are explicit SQL fixtures;
// this is not an interactive GoTrue login test or a deployment.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {inspectSpace} from '../scripts/workspace-space.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
const fixture=process.argv.find(a=>a.startsWith('--fixture='))?.slice(10);
assert.match(fixture||'',/^[a-f0-9]{8}$/);
const base='/tmp/shadowbridge-r1-isolated',D=['--host','unix://'+base+'/overlay.sock'];
assert.equal((await inspectSpace({directory:base,dockerRoot:base+'/overlay-data'})).result,'PASS');
const docker=(a,o={})=>execFileSync('docker',[...D,...a],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024**2,...o}).trim();
const pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';
const sql=(database,q)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:q});
const source=JSON.parse(await readFile(new URL('../.local/owner-book-'+fixture+'/results.json',import.meta.url),'utf8'));
const build=JSON.parse(await readFile(new URL('../.local/owner-book-build/results.json',import.meta.url),'utf8'));
assert.equal(source.result,'PASS');const image=build.targets.find(x=>x.target==='runtime');assert.equal(image.result,'PASS');
const template=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-app-1']))[0];
const tag=randomBytes(4).toString('hex'),db='owner_book_runtime_'+tag;
const dir=new URL('../.local/owner-book-runtime-'+tag+'/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const result={kind:'native-owner-book-runtime',sourceSha:build.sourceSha,imageId:image.imageId,cases:[],productionChanges:false,interactiveGoTrueLoginTested:false};
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";let active;
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});console.log('PASS '+name);};
try{
 sql('postgres','CREATE DATABASE '+db+' TEMPLATE '+source.databaseRetained);
 const owner=sql(db,"SELECT id FROM auth.users WHERE email="+lit('fictional-owner-'+fixture+'@ownerbook.test.invalid'));assert.match(owner,/^[a-f0-9-]{36}$/);
 const rpc=(action,p)=>JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(owner)+';SET LOCAL "request.jwt.claim.aal"=\'aal2\';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)))+';SELECT owner_book.owner_rpc('+lit(action)+',NULL,'+lit(JSON.stringify(p))+'::jsonb,'+lit(randomUUID())+'::uuid,NULL);COMMIT;'));
 const key='sbob_'+randomBytes(32).toString('base64url');
 const issued=rpc('key_create',{name:'FICTIONAL native runtime',mode:'read_only',scopes:['task.read'],expiresAt:new Date(Date.now()+86400000).toISOString(),tokenHash:createHash('sha256').update(key).digest('hex')});assert.equal(issued.status,200);
 const network=Object.keys(template.NetworkSettings.Networks)[0];assert.match(network,/^shadowbridge-stageg-r1full-[a-f0-9]+_/);
 const start=async enabled=>{
  active='shadowbridge-book-native-'+tag+'-'+String(enabled);
  const env=template.Config.Env.filter(s=>!s.startsWith('OWNER_BOOK_API_ENABLED=')).map(s=>{const i=s.indexOf('='),n=s.slice(0,i);if(['DATABASE_URL','SESSION_DATABASE_URL'].includes(n)){const u=new URL(s.slice(i+1));u.pathname='/'+db;return n+'='+u.href;}if(n==='RELEASE_SHA')return 'RELEASE_SHA='+build.sourceSha;return s;});
  env.push('OWNER_BOOK_API_ENABLED='+String(enabled));const file=new URL('runtime-'+enabled+'.env',dir).pathname;await writeFile(file,env.join('\n')+'\n',{mode:0o600});
  const args=['run','-d','--name',active,'--label','io.shadowbridge.test=owner-book-native','--network',network,'--env-file',file];
  for(const m of template.Mounts){assert.equal(m.Type,'bind');assert.equal(m.RW,false);args.push('--mount','type=bind,source='+m.Source+',target='+m.Destination+',readonly');}
  args.push(image.imageId);docker(args);
  for(let i=0;i<100;i++){try{if(request('/health').status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Native runtime did not become healthy');
 };
 // Token only travels over stdin; never argv, a log, a screenshot or a report.
 const request=(path,opts={})=>JSON.parse(docker(['exec','-i',active,'node','--input-type=module','-e',"let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s);const r=await fetch('http://127.0.0.1:8088'+p.path,p.options);const t=await r.text();let body;try{body=JSON.parse(t)}catch{body=t.slice(0,60)}console.log(JSON.stringify({status:r.status,body}));"],{input:JSON.stringify({path,options:opts})}));
 const auth={authorization:'Bearer '+key};
 await phase('built non-root runtime starts with real verify-full PostgreSQL and remote API remains disabled by default',async()=>{
  await start(false);assert.equal(request('/health').body.ok,true);assert.equal(request('/api/config').body.backendEnabled,true);assert.equal(request('/api/integrations/owner-book/v1/entries?kind=task',{headers:auth}).status,503);
  assert.equal(JSON.parse(docker(['inspect',active]))[0].Config.User,'node');assert.equal(request('/assets/owner-book.js').status,200);docker(['stop',active]);active=null;
 });
 await phase('enabled native API uses the restricted session pool and enforces read scopes and browser separation',async()=>{
  await start(true);const tasks=request('/api/integrations/owner-book/v1/entries?kind=task',{headers:auth});assert.equal(tasks.status,200);assert.ok(Array.isArray(tasks.body.items));
  assert.equal(request('/api/integrations/owner-book/v1/entries?kind=idea',{headers:auth}).status,403);
  assert.equal(request('/api/integrations/owner-book/v1/entries?kind=task',{headers:{...auth,cookie:'fixture=blocked'}}).status,403);
  const command=randomUUID();assert.equal(request('/api/integrations/owner-book/v1/entries',{method:'POST',headers:{...auth,'content-type':'application/json','x-shadowbridge-command-id':command,'x-shadowbridge-explicit-write':'true'},body:JSON.stringify({requestKey:command,entry:{kind:'task',title:'FICTIONAL prohibited write'}})}).status,403);
 });
 await phase('CUSTOM assistant creates and edits an actual idea once, rejects changed replay, forbidden scopes and account access',async()=>{
  const raw='sbob_'+randomBytes(32).toString('base64url'),scopes=['task.read','task.write','note.read','note.write','idea.read','idea.write','event.read','event.write','journal.read','summary.export'];
  const issued=rpc('key_create',{name:'FICTIONAL native assistant',mode:'custom',scopes,expiresAt:new Date(Date.now()+86400000).toISOString(),tokenHash:createHash('sha256').update(raw).digest('hex')});assert.equal(issued.status,200);
  const headers={authorization:'Bearer '+raw,'content-type':'application/json'},base='/api/integrations/owner-book/v1',command=randomUUID(),entry={kind:'idea',title:'FICTIONAL native assistant idea',body:'FICTIONAL confirmed command'};
  const write=(path,p,h=headers)=>request(base+path,{method:path==='/assistant/entries'?'POST':'PUT',headers:{'content-type':'application/json',...h},body:JSON.stringify(p)}),p={entry,requestKey:command,explicitWrite:true};
  const created=write('/assistant/entries',p);assert.equal(created.status,200);const item=created.body;assert.ok(item.id);assert.equal(write('/assistant/entries',p).body.id,item.id);
  assert.equal(write('/assistant/entries',{...p,entry:{...entry,title:'Changed replay'}}).status,409);assert.equal(write('/assistant/entries',{...p,requestKey:randomUUID(),explicitWrite:false}).status,403);
  assert.equal(write('/assistant/entries',{...p,requestKey:randomUUID()},auth).status,403);
  assert.equal(write('/assistant/entries/'+item.id,{explicitWrite:true,requestKey:randomUUID(),entry:{...entry,version:item.version,body:'FICTIONAL updated through the real native API'}}).status,200);
  assert.equal(request(base+'/entries/'+item.id+'?kind=idea',{headers}).body.body,'FICTIONAL updated through the real native API');
  for(const kind of ['task','note','event']){const record={kind,title:'FICTIONAL native '+kind,body:'FICTIONAL confirmed '+kind,...(kind==='event'?{starts_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString()}:{} )};const saved=write('/assistant/entries',{entry:record,requestKey:randomUUID(),explicitWrite:true});assert.equal(saved.status,200);assert.equal(request(base+'/entries/'+saved.body.id+'?kind='+kind,{headers}).body.kind,kind);}
  const other=sql(db,"SELECT id FROM auth.users WHERE email="+lit('fictional-owner2-'+fixture+'@ownerbook.test.invalid'));assert.match(other,/^[a-f0-9-]{36}$/);
  const otherRecord=JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(other)+';SET LOCAL "request.jwt.claim.aal"=\'aal2\';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)))+';SELECT owner_book.owner_rpc(\'save\',\'note\','+lit(JSON.stringify({kind:'note',title:'FICTIONAL other OWNER private note'}))+'::jsonb,'+lit(randomUUID())+'::uuid,'+lit(randomUUID())+'::uuid);COMMIT;'));assert.equal(otherRecord.status,200);assert.equal(request(base+'/entries/'+otherRecord.data.id+'?kind=note',{headers}).status,404);
  const summary=request(base+'/export?kinds=idea',{headers});assert.equal(summary.status,200);assert.ok(summary.body.items.some(e=>e.id===item.id));assert.equal(request(base+'/journal?window=24h',{headers}).status,200);
  assert.equal(request(base+'/entries?kind=decision',{headers}).status,403);assert.equal(request(base+'/keys',{headers}).status,403);
  assert.equal(request('/api/owner/vault/contacts',{headers}).status,401);
  assert.equal(sql(db,"SELECT count(*) FROM owner_book.entries WHERE title='FICTIONAL native assistant idea'"),'1');
  assert.equal(rpc('key_revoke',{id:issued.data.id}).status,200);assert.equal(request(base+'/entries?kind=idea',{headers}).status,401);assert.equal(write('/assistant/entries',{...p,requestKey:randomUUID()}).status,401);
 });
 await phase('native HTTP API rejects the same scoped key after its real expiry, and logs the denial',async()=>{
  const raw='sbob_'+randomBytes(32).toString('base64url'),key=rpc('key_create',{name:'FICTIONAL native expiry',mode:'custom',scopes:['note.read'],expiresAt:new Date(Date.now()+4000).toISOString(),tokenHash:createHash('sha256').update(raw).digest('hex')});assert.equal(key.status,200);
  const headers={authorization:'Bearer '+raw};assert.equal(request('/api/integrations/owner-book/v1/entries?kind=note',{headers}).status,200);await new Promise(r=>setTimeout(r,4100));assert.equal(request('/api/integrations/owner-book/v1/entries?kind=note',{headers}).status,401);
  assert.equal(sql(db,"SELECT count(*) FROM owner_book.audit WHERE key_id="+lit(key.data.id)+"::uuid AND outcome='denied'"),'1');
 });
 await phase('OWNER SQL revocation immediately blocks the previously valid native API key without changing account or MFA',async()=>{
  const before=sql(db,"SELECT md5(to_jsonb(u)::text||(SELECT jsonb_agg(to_jsonb(f) ORDER BY id)::text FROM auth.mfa_factors f WHERE user_id=u.id)) FROM auth.users u WHERE id="+lit(owner));
  assert.equal(rpc('key_revoke',{id:issued.data.id}).status,200);assert.equal(request('/api/integrations/owner-book/v1/entries?kind=task',{headers:auth}).status,401);
  assert.equal(sql(db,"SELECT md5(to_jsonb(u)::text||(SELECT jsonb_agg(to_jsonb(f) ORDER BY id)::text FROM auth.mfa_factors f WHERE user_id=u.id)) FROM auth.users u WHERE id="+lit(owner)),before);
 });
 result.result='PASS';
}catch(e){result.result='FAIL';await writeFile(new URL('private-failure.json',dir),JSON.stringify({message:e.message,stack:e.stack,stderr:String(e.stderr||'')})+'\n',{mode:0o600});console.error('FAIL: see private native runtime diagnostic');process.exitCode=1;}
finally{if(active)docker(['stop',active]);result.databaseRetained=db;result.testContainersStopped=true;await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
