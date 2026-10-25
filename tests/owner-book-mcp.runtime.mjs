// Real built image + TLS PostgreSQL, only on a new clone of a retained fictional
// fixture. SQL OWNER/MFA setup is explicit; not a GoTrue/browser/production test.
import assert from'node:assert/strict';import{execFileSync}from'node:child_process';
import{readFile,writeFile,mkdir}from'node:fs/promises';import{randomBytes,randomUUID,createHash}from'node:crypto';
import{inspectSpace}from'../scripts/workspace-space.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
const fixture=process.argv.find(a=>a.startsWith('--fixture='))?.slice(10);assert.match(fixture||'',/^[a-f0-9]{8}$/);
const base='/tmp/shadowbridge-r1-isolated',D=['--host','unix://'+base+'/overlay.sock'];
assert.equal((await inspectSpace({directory:base,dockerRoot:base+'/overlay-data'})).result,'PASS');
const docker=(a,o={})=>execFileSync('docker',[...D,...a],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024**2,...o}).trim();
const pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1',sql=(db,q)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],{input:q}),lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const revision=process.argv.find(a=>a.startsWith('--build='))?.slice(8);assert.match(revision||'',/^[a-f0-9]{40}$/);
const source=JSON.parse(await readFile(new URL('../.local/owner-book-'+fixture+'/results.json',import.meta.url))),build=JSON.parse(await readFile(new URL('../.local/'+('mcp-native-build-'+revision.slice(0,12))+'/results.json',import.meta.url)));
assert.equal(source.result,'PASS');assert.match(source.databaseRetained,/^owner_book_test_[a-f0-9]{8}$/);assert.equal(build.result,'PASS');assert.equal(build.sourceSha,revision);
const template=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-app-1']))[0],tag=randomBytes(4).toString('hex'),db='mcp_runtime_'+tag,dir=new URL('../.local/mcp-runtime-'+tag+'/',import.meta.url);
await mkdir(dir,{recursive:true,mode:0o700});let active;
const result={kind:'native-mcp-real-postgresql',sourceSha:build.sourceSha,imageId:build.imageId,productionChanges:false,interactiveGoTrueLoginTested:false,pluginCreatorTested:false,cases:[]};
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});console.log('PASS '+name);};
const accounts=database=>sql(database,"SELECT md5((SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'[]') FROM auth.users u)||(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id)::text,'[]') FROM auth.mfa_factors f))");
const request=(path,options={})=>JSON.parse(docker(['exec','-i',active,'node','--input-type=module','-e',"let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s),r=await fetch('http://127.0.0.1:8088'+p.path,p.options),t=await r.text();let body;try{body=JSON.parse(t)}catch{body=null}console.log(JSON.stringify({status:r.status,body}));"],{input:JSON.stringify({path,options})}));
const rpc=(owner,action,kind,p)=>JSON.parse(sql(db,'SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(owner)+';SET LOCAL "request.jwt.claim.aal"=\'aal2\';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)))+';SELECT owner_book.owner_rpc('+lit(action)+','+(kind?lit(kind):'NULL')+','+lit(JSON.stringify(p))+'::jsonb,'+lit(randomUUID())+'::uuid,'+(action==='save'?lit(randomUUID())+'::uuid':'NULL')+');COMMIT;'));
const start=async mcp=>{
 active='shadowbridge-mcp-native-'+tag+'-'+String(mcp);
 const env=template.Config.Env.filter(v=>!/^OWNER_BOOK_(API|MCP)_ENABLED=/.test(v)).map(v=>{const i=v.indexOf('='),k=v.slice(0,i);if(['DATABASE_URL','SESSION_DATABASE_URL'].includes(k)){const u=new URL(v.slice(i+1));assert.ok(['shadowbridge_api','shadowbridge_sessions'].includes(u.username));assert.equal(u.searchParams.get('sslmode'),'verify-full');u.pathname='/'+db;return k+'='+u.href;}return k==='RELEASE_SHA'?'RELEASE_SHA='+build.sourceSha:v;});
 env.push('OWNER_BOOK_API_ENABLED=true','OWNER_BOOK_MCP_ENABLED='+String(mcp));const file=new URL('runtime-'+mcp+'.env',dir).pathname;await writeFile(file,env.join('\n')+'\n',{mode:0o600});
 const network=Object.keys(template.NetworkSettings.Networks)[0];assert.match(network,/^shadowbridge-stageg-r1full-[a-f0-9]+_/);
 const args=['run','-d','--name',active,'--label','io.shadowbridge.test=mcp-native','--network',network,'--env-file',file];for(const m of template.Mounts){assert.equal(m.Type,'bind');assert.equal(m.RW,false);args.push('--mount','type=bind,source='+m.Source+',target='+m.Destination+',readonly');}args.push(build.imageId);docker(args);
 for(let i=0;i<100;i++){try{if(request('/health').status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Native MCP app did not become healthy');
};
try{
 const original=accounts(source.databaseRetained);sql('postgres','CREATE DATABASE '+db+' TEMPLATE '+source.databaseRetained);
 const owner=sql(db,"SELECT id FROM auth.users WHERE email="+lit('fictional-owner-'+fixture+'@ownerbook.test.invalid')),other=sql(db,"SELECT id FROM auth.users WHERE email="+lit('fictional-owner2-'+fixture+'@ownerbook.test.invalid'));assert.match(owner,/^[a-f0-9-]{36}$/);assert.match(other,/^[a-f0-9-]{36}$/);
 const before=accounts(db),title='FICTIONAL MCP '+tag;
 const note=rpc(owner,'save','note',{kind:'note',title,body:'FICTIONAL note for the native MCP test'});assert.equal(note.status,200);
 const hidden=rpc(other,'save','note',{kind:'note',title,body:'FICTIONAL other OWNER confidential content'});assert.equal(hidden.status,200);
 const issue=(name,scopes,ms=86400000,mode='read_only')=>{const raw='sbob_'+randomBytes(32).toString('base64url'),r=rpc(owner,'key_create',null,{name,mode,scopes,expiresAt:new Date(Date.now()+ms).toISOString(),tokenHash:createHash('sha256').update(raw).digest('hex')});assert.equal(r.status,200);return{raw,id:r.data.id};};
 const narrow=issue('FICTIONAL MCP note only',['note.read']);
 const mcp=(key,method,params={},id=1)=>request('/api/integrations/owner-book/v1/mcp',{method:'POST',headers:{authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params})});
 await phase('native non-root image preserves REST while MCP is separately disabled',async()=>{await start(false);assert.equal(JSON.parse(docker(['inspect',active]))[0].Config.User,'node');assert.equal(mcp(narrow.raw,'tools/list').status,503);assert.equal(request('/api/integrations/owner-book/v1/entries?kind=note',{headers:{authorization:'Bearer '+narrow.raw}}).status,200);docker(['stop',active]);active=null;});
 await phase('actual restricted TLS PostgreSQL authorizes handshake and note.read; other OWNER notes stay isolated',async()=>{
  await start(true);let r=mcp(narrow.raw,'initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'fictional-native-client',version:'1'},capabilities:{}});assert.equal(r.status,200);assert.equal(r.body.result.protocolVersion,'2025-06-18');assert.equal(mcp(narrow.raw,'notifications/initialized',{},null).status,202);
  assert.deepEqual(mcp(narrow.raw,'tools/list').body.result.tools.map(t=>t.name),['read_notes','read_book_entries','read_activity']);
  r=mcp(narrow.raw,'tools/call',{name:'read_notes',arguments:{q:title}});assert.equal(r.status,200);assert.deepEqual(r.body.result.structuredContent.items.map(n=>n.id),[note.data.id]);assert.ok(!JSON.stringify(r).includes(hidden.data.body));
  assert.equal(mcp(narrow.raw,'tools/call',{name:'read_book_entries',arguments:{kind:'task'}}).status,403);assert.equal(mcp(narrow.raw,'tools/call',{name:'read_activity'}).status,403);assert.equal(mcp('invalid','tools/list').status,401);
  const archived=rpc(owner,'save','note',{kind:'note',title:'FICTIONAL archived '+tag,body:'FICTIONAL historical source',archived:true});assert.equal(archived.status,200);assert.equal(mcp(narrow.raw,'tools/call',{name:'read_notes',arguments:{q:'FICTIONAL archived '+tag}}).body.result.structuredContent.items.length,0);const history=mcp(narrow.raw,'tools/call',{name:'read_notes',arguments:{q:'FICTIONAL archived '+tag,archived:'all'}});assert.equal(history.status,200);assert.deepEqual(history.body.result.structuredContent.items.map(n=>n.id),[archived.data.id]);
 });
 const operational=issue('FICTIONAL MCP operational reads',['note.read','task.read','idea.read','event.read','decision.read','journal.read']);
 await phase('scoped operational reads use real task/decision RPC and redacted journal; writes remain denied',async()=>{
  for(const kind of ['task','decision'])assert.equal(rpc(owner,'save',kind,{kind,title:'FICTIONAL operational '+kind+' '+tag}).status,200);
  for(const kind of ['task','idea','event','decision'])assert.equal(mcp(operational.raw,'tools/call',{name:'read_book_entries',arguments:{kind}}).status,200);
  const r=mcp(operational.raw,'tools/call',{name:'read_activity',arguments:{window:'24h'}});assert.equal(r.status,200);assert.equal(r.body.result.structuredContent.automation.actualCredits,null);
  assert.equal(mcp(operational.raw,'tools/call',{name:'create_task'}).body.error.code,-32602);
  const id=randomUUID();assert.equal(request('/api/integrations/owner-book/v1/entries',{method:'POST',headers:{authorization:'Bearer '+operational.raw,'Content-Type':'application/json','X-ShadowBridge-Command-ID':id,'X-ShadowBridge-Explicit-Write':'true'},body:JSON.stringify({requestKey:id,entry:{kind:'task',title:'FICTIONAL denied native MCP write'}})}).status,403);
  assert.equal(sql(db,"SELECT count(*) FROM owner_book.entries WHERE title='FICTIONAL denied native MCP write'"),'0');
 });
 await phase('existing API imports a fictional batch once, revokes temporary write and preserves independent READ ONLY',async()=>{
  const temporary=issue('FICTIONAL temporary import',['note.read','note.write','records.import'],86400000,'custom'),command=randomUUID(),prefix='FICTIONAL imported MCP '+tag;
  const payload={items:[1,2].map(n=>({kind:'note',title:prefix+' '+n,body:'FICTIONAL approved import',source_ref:'fictional-import-'+tag+'-'+n})),requestKey:command,confirm:true};
  const write=()=>request('/api/integrations/owner-book/v1/import',{method:'POST',headers:{authorization:'Bearer '+temporary.raw,'Content-Type':'application/json','X-ShadowBridge-Command-ID':command,'X-ShadowBridge-Explicit-Write':'true'},body:JSON.stringify(payload)});
  const first=write();assert.equal(first.status,200);assert.deepEqual(write().body,first.body);assert.equal(sql(db,"SELECT count(*) FROM owner_book.entries WHERE source_ref LIKE "+lit('fictional-import-'+tag+'-%')),'2');
  assert.equal(rpc(owner,'key_revoke',null,{id:temporary.id}).status,200);assert.equal(write().status,401);assert.equal(request('/api/integrations/owner-book/v1/entries?kind=note',{headers:{authorization:'Bearer '+temporary.raw}}).status,401);
  const read=mcp(operational.raw,'tools/call',{name:'read_notes',arguments:{q:prefix}});assert.equal(read.status,200);assert.equal(read.body.result.structuredContent.items.length,2);
 });
 await phase('real expiry and OWNER revocation deny MCP, while a separate READ ONLY key remains valid',async()=>{
  const short=issue('FICTIONAL MCP short expiry',['note.read'],4000);assert.equal(mcp(short.raw,'tools/list').status,200);await new Promise(r=>setTimeout(r,4100));assert.equal(mcp(short.raw,'tools/call',{name:'read_notes'}).status,401);
  assert.equal(rpc(owner,'key_revoke',null,{id:narrow.id}).status,200);assert.equal(mcp(narrow.raw,'tools/list').status,401);assert.equal(mcp(narrow.raw,'tools/call',{name:'read_notes'}).status,401);assert.equal(mcp(operational.raw,'tools/call',{name:'read_notes',arguments:{q:title}}).status,200);
  assert.ok(Number(sql(db,'SELECT count(*) FROM owner_book.audit WHERE key_id='+lit(narrow.id)+'::uuid'))>0);
 });
 await phase('fictional accounts, password/MFA records and the original retained database are unchanged',async()=>{assert.equal(accounts(db),before);assert.equal(accounts(source.databaseRetained),original);result.accountsAndMfaPreserved=true;});
 result.result='PASS';
}catch(e){result.result='FAIL';await writeFile(new URL('private-failure.json',dir),JSON.stringify({message:e.message,stack:e.stack,stderr:String(e.stderr||'')})+'\n',{mode:0o600});console.error('FAIL: inspect private native MCP checkpoint');process.exitCode=1;}
finally{if(active)docker(['stop',active]);result.databaseRetained=db;result.testContainersStopped=true;await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
