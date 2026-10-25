import test from'node:test';import assert from'node:assert/strict';import{randomBytes,randomUUID}from'node:crypto';
import{appendInput,bookCreateTools,routeBookAppend}from'../owner-book-append.mjs';import{authorizationParameters,oauthMetadata}from'../owner-book-oauth.mjs';
import{routeBookMcp}from'../owner-book-mcp.mjs';import{certifyReviewBackup}from'../../scripts/book-append-backup.mjs';
const id=randomUUID(),base={title:'FICTIONAL proposed addition',source_ref:'fictional:test:'+id,body:'Fictional source only.'};
test('five create operations normalize through existing Book validation, reject identifiers/versions/contacts and need stable sources',()=>{
 assert.deepEqual(bookCreateTools.slice(0,5).map(t=>t.name),['create_note','create_idea','create_task','create_event','create_decision']);
 for(const kind of ['note','idea','task','event','decision']){const r=appendInput('create_'+kind,{entry:{...base,...(kind==='event'?{starts_at:'2026-10-25T12:00:00+01:00'}:{})},requestKey:id});assert.equal(r.action,'preview');assert.equal(r.p.items[0].kind,kind);}
 for(const item of [{...base,id:randomUUID()},{...base,version:1},{...base,company:{name:'Not a Book record'}},{...base,source_ref:''},{...base,kind:'note'}])assert.throws(()=>appendInput('create_note',{entry:item,requestKey:id}));
 assert.throws(()=>appendInput('prepare_book_import',{items:[{...base,kind:'note'},{...base,kind:'task'}],requestKey:id}));assert.throws(()=>appendInput('apply_book_import',{reviewId:id,explicitCreate:false}));
 assert.ok(bookCreateTools.every(t=>t.annotations.destructiveHint===false&&!t.name.includes('delete')&&!t.name.includes('update')));
});
test('OAuth defaults remain read-only; temporary create scopes require explicit matching read grants and never accept generic writes',()=>{
 const p=new URLSearchParams({client_id:'sboc_'+id,response_type:'code',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',scope:'note.read task.read task.create',state:randomBytes(20).toString('base64url'),resource:'https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',code_challenge:'c'.repeat(43),code_challenge_method:'S256'});
 assert.throws(()=>authorizationParameters(p));assert.ok(authorizationParameters(p,{createEnabled:true}).scopes.includes('task.create'));
 p.set('scope','note.read task.create');assert.throws(()=>authorizationParameters(p,{createEnabled:true}));p.set('scope','note.read task.write');assert.throws(()=>authorizationParameters(p,{createEnabled:true}));
 assert.equal(oauthMetadata('/.well-known/oauth-authorization-server').scopes_supported.length,6);assert.equal(oauthMetadata('/.well-known/oauth-authorization-server',{createEnabled:true}).scopes_supported.length,11);
});
test('only OAuth bearer can reach append RPC; SQL receives a digest and creates a proposal, never a forged approval/backup',async()=>{
 let calls=0;const token='sboa_'+randomBytes(32).toString('base64url'),pool={query:async(sql,a)=>{calls++;assert.ok(sql.includes('owner_book.append_rpc'));assert.equal(a[0],'preview');assert.ok(!JSON.stringify(a).includes(token));return{rows:[{result:{status:200,data:{created:false,reviewId:id}}}]};}};
 const input={req:{headers:{authorization:'Bearer '+token}},name:'create_note',args:{entry:base,requestKey:id},sessionPool:pool,clientHash:'a'.repeat(64)};
 assert.equal((await routeBookAppend(input)).data.created,false);assert.equal(calls,1);
 assert.equal((await routeBookAppend({...input,req:{headers:{authorization:'Bearer sbob_'+randomBytes(32).toString('base64url')}}})).status,401);assert.equal(calls,1);
});
test('MCP does not expose append tools unless explicitly enabled; the enabled existing endpoint stages and returns truthful state',async()=>{
 const sessionPool={query:async(q)=>({rows:[{result:q.includes('append_rpc')?{status:200,data:{created:false,reviewId:id,phase:'prepared'}}:{status:404,data:{}}}]})};
 const common={req:{method:'POST',headers:{authorization:'Bearer sboa_'+randomBytes(32).toString('base64url'),accept:'application/json, text/event-stream'}},url:new URL('https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp'),sessionPool,clientHash:'b'.repeat(64),oauthEnabled:true};
 const list=async enabled=>routeBookMcp({...common,createEnabled:enabled,body:async()=>({jsonrpc:'2.0',id:1,method:'tools/list'})});
 assert.equal((await list(false)).data.result.tools.length,3);assert.equal((await list(true)).data.result.tools.length,10);
 const result=await routeBookMcp({...common,createEnabled:true,body:async()=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_note',arguments:{entry:base,requestKey:id}}})});assert.equal(result.data.result.structuredContent.created,false);assert.equal(result.data.result.isError,false);
});
test('operator backup receipt requires actual approval, authenticated archive, unchanged live snapshot and correct order; no import is invoked',async()=>{
 const state={phase:'approved',snapshotCurrent:true,candidateHash:'a',snapshotHash:'b',approvedAt:'2026-10-25T12:00:00Z'},steps=[];
 const ops={review:async()=>{steps.push('review');return state;},backup:async()=>{steps.push('backup');return{};},verify:async()=>{steps.push('verify');return{archiveAuthenticated:true,catalogReadable:true};},record:async()=>{steps.push('record');return{imported:false};}};
 assert.equal((await certifyReviewBackup(ops)).imported,false);assert.deepEqual(steps,['review','backup','verify','review','record']);
 for(const patch of [{review:async()=>({...state,phase:'prepared'})},{verify:async()=>({archiveAuthenticated:false,catalogReadable:true})},{review:(()=>{let n=0;return async()=>++n===1?state:{...state,snapshotCurrent:false};})()}]){let recorded=false;await assert.rejects(certifyReviewBackup({...ops,...patch,record:async()=>{recorded=true;}}));assert.equal(recorded,false);}
});

test('a READ ONLY client gets an insufficient_scope OAuth challenge for separate consent, not an implicit permission upgrade',async()=>{
 const req={method:'POST',headers:{authorization:'Bearer sboa_'+randomBytes(32).toString('base64url'),accept:'application/json, text/event-stream'}},sessionPool={query:async()=>({rows:[{result:{status:403,data:{code:'APPEND_SCOPE_REQUIRED'}}}]})};
 const r=await routeBookMcp({req,url:new URL('https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp'),sessionPool,body:async()=>({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'create_note',arguments:{entry:base,requestKey:id}}}),clientHash:'c'.repeat(64),oauthEnabled:true,createEnabled:true});
 assert.equal(r.status,403);assert.match(r.headers['WWW-Authenticate'],/error="insufficient_scope"/);assert.match(r.headers['WWW-Authenticate'],/scope="note.read note.create"/);assert.equal(r.data.result.isError,true);assert.ok(r.data.result._meta['mcp/www_authenticate'].length===1);
});
