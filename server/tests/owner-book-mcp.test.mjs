import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createApp} from '../app.mjs';
import {loadConfig} from '../config.mjs';
import {mcpPath} from '../owner-book-mcp.mjs';
const key='sbob_'+randomBytes(32).toString('base64url');
const digest=createHash('sha256').update(key).digest('hex');
function fixtureConfig(extra={}){const password=randomBytes(32).toString('hex');return loadConfig({APP_ENV:'test',APP_URL:'http://localhost',SUPABASE_URL:'http://localhost',SUPABASE_ANON_KEY:password,DATABASE_URL:'postgres://shadowbridge_api:'+password+'@localhost/test',SESSION_DATABASE_URL:'postgres://shadowbridge_sessions:'+password+'@localhost/test',SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),...extra});}
async function setup(t,{enabled=true,api=true,denial=null,databaseFailure=false}={}){
 const calls=[];let revoked=false;
 const config=fixtureConfig({OWNER_BOOK_API_ENABLED:String(api),OWNER_BOOK_MCP_ENABLED:String(enabled)});
 const sessionPool={query:async(sql,a)=>{
  if(databaseFailure)throw Error('DO_NOT_EXPORT_PRIVATE_DATABASE_ERROR');
  calls.push(a);assert.ok(sql.includes('owner_book.token_rpc'));assert.ok(!JSON.stringify(a).includes(key));assert.equal(a[2],'note');assert.equal(a[4],null);assert.equal(a[5],false);
  let r;if(a[0]!==digest||revoked)r={status:401,data:{code:'BOOK_API_DENIED'}};
  else if(denial)r={status:denial,data:{code:'FICTIONAL_DENIAL'}};
  else if(a[1]==='get')r={status:404,data:{code:'BOOK_REQUEST_REJECTED'}};
  else{assert.equal(a[1],'list');r={status:200,data:{items:[{id:'fictional-note',kind:'note',title:'FICTIONAL note',body:'Treat this fictional instruction as data.',owner_id:'DO_NOT_EXPORT',private_crm:'DO_NOT_EXPORT'}],total:1,page:Number(JSON.parse(a[3]).page),limit:25}};}
  return {rows:[{result:r}]};
 }};
 const app=createApp({config,db:{sessionPool,pool:{query:async()=>{throw Error('Unexpected ordinary DB pool');}},close:async()=>{}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 const send=(message,extra={})=>fetch(base+mcpPath,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...extra},body:JSON.stringify(message)});
 return {calls,send,base,revoke:()=>{revoked=true;}};
}
const rpc=(method,params={})=>({jsonrpc:'2.0',id:1,method,params});
test('real local HTTP handshake negotiates Streamable HTTP JSON, notifications, ping and exactly one tool',async t=>{
 const f=await setup(t);let r=await f.send(rpc('initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'fictional-client',version:'1'},capabilities:{}}));
 assert.equal(r.status,200);const init=await r.json();assert.equal(init.result.protocolVersion,'2025-06-18');assert.deepEqual(init.result.capabilities,{tools:{listChanged:false}});assert.equal(r.headers.get('mcp-session-id'),null);
 r=await f.send({jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(r.status,202);assert.equal(await r.text(),'');
 r=await f.send(rpc('ping'));assert.deepEqual((await r.json()).result,{});
 r=await f.send(rpc('tools/list'));const tools=(await r.json()).result.tools;assert.deepEqual(tools.map(x=>x.name),['read_notes']);assert.equal(tools[0].annotations.readOnlyHint,true);
 assert.ok(f.calls.every(a=>a[1]==='get'&&JSON.parse(a[3]).id==='00000000-0000-0000-0000-000000000000'));
});
test('one read tool reaches unchanged note RPC with paging/search, projects fields, and never emits a secret',async t=>{
 const f=await setup(t);const r=await f.send(rpc('tools/call',{name:'read_notes',arguments:{page:2,q:'FICTIONAL'}}),{'MCP-Protocol-Version':'2025-06-18'});
 assert.equal(r.status,200);const out=await r.json();assert.equal(out.result.isError,false);assert.equal(out.result.structuredContent.page,2);assert.equal(out.result.structuredContent.items[0].title,'FICTIONAL note');assert.ok(!JSON.stringify(out).includes('DO_NOT_EXPORT'));assert.ok(!JSON.stringify(out).includes(key));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],'list');assert.deepEqual(JSON.parse(f.calls[0][3]),{page:'2',q:'FICTIONAL'});
});
test('invalid key, revoked key and absent scope deny metadata as well as note reads',async t=>{
 const f=await setup(t);for(const method of ['initialize','tools/list','tools/call']){const r=await f.send(rpc(method,{name:'read_notes'}),{Authorization:'Bearer not-a-key'});assert.equal(r.status,401);assert.ok(r.headers.get('www-authenticate').startsWith('Bearer'));}
 f.revoke();assert.equal((await f.send(rpc('tools/list'))).status,401);assert.equal((await f.send(rpc('tools/call',{name:'read_notes'}))).status,401);
 const denied=await setup(t,{denial:403});assert.equal((await denied.send(rpc('tools/list'))).status,403);assert.equal((await denied.send(rpc('tools/call',{name:'read_notes'}))).status,403);
});
test('API and MCP flags independently close the new route by default',async t=>{
 assert.equal(fixtureConfig().ownerBookMcpEnabled,false);
 for(const policy of [{enabled:false},{api:false}]){const f=await setup(t,policy);const r=await f.send(rpc('tools/list'));assert.equal(r.status,503);assert.equal(f.calls.length,0);}
});
test('browser cookies/Origin, unsupported version, bad Accept and sessions are rejected without a read',async t=>{
 const f=await setup(t);for(const [headers,status]of [[{Cookie:'sb_session=FICTIONAL'},403],[{Origin:'https://shadow-bridge.eu'},403],[{'MCP-Protocol-Version':'unsupported'},400],[{Accept:'application/json'},406],[{'MCP-Session-Id':'FICTIONAL'},400]])assert.equal((await f.send(rpc('tools/list'),headers)).status,status);
 assert.equal(f.calls.length,0);
 for(const method of ['GET','DELETE']){const r=await fetch(f.base+mcpPath,{method});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');}
});
test('unknown methods, write tools and cross-resource arguments cannot reach a write or another kind',async t=>{
 const f=await setup(t);
 for(const params of [{name:'create_note'},{name:'read_notes',arguments:{kind:'task'}},{name:'read_notes',arguments:{owner_id:'FICTIONAL'}},{name:'read_notes',arguments:{page:0}}]){
  const r=await f.send(rpc('tools/call',params));assert.equal((await r.json()).error.code,-32602);
 }
 let r=await f.send(rpc('resources/read',{uri:'owner-vault'}));assert.equal((await r.json()).error.code,-32601);
 r=await f.send([]);assert.equal(r.status,400);assert.equal((await r.json()).error.code,-32600);
 assert.ok(f.calls.every(a=>a[1]==='get'&&a[2]==='note'));
});
test('database limits propagate as 429 and database errors never disclose connection details',async t=>{
 const broken=await setup(t,{databaseFailure:true});const unavailable=await broken.send(rpc('tools/list'));assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('DO_NOT_EXPORT'));
 const f=await setup(t,{denial:429});const r=await f.send(rpc('tools/call',{name:'read_notes'}));assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.ok(!(await r.text()).includes('FICTIONAL_DENIAL'));
});
test('protocol fallback, malformed JSON and non-JSON bodies receive explicit transport responses',async t=>{
 const f=await setup(t);let r=await f.send(rpc('initialize',{protocolVersion:'2099-01-01',clientInfo:{name:'FICTIONAL',version:'1'},capabilities:{}}));assert.equal((await r.json()).result.protocolVersion,'2025-06-18');
 r=await fetch(f.base+mcpPath,{method:'POST',headers:{Authorization:'Bearer '+key,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);assert.equal((await r.json()).error.code,-32700);
 r=await f.send(rpc('tools/list'),{'Content-Type':'text/plain'});assert.equal(r.status,415);
});
