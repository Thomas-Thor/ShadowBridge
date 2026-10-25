import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID,randomBytes}from'node:crypto';
import{writeInput,routeBookWrite,bookWriteTools}from'../owner-book-write.mjs';import{authorizationParameters,oauthMetadata,oauthResource}from'../owner-book-oauth.mjs';import{routeBookMcp}from'../owner-book-mcp.mjs';
const id=randomUUID(),key=randomUUID(),token='sboa_'+randomBytes(32).toString('base64url'),clientHash='a'.repeat(64),args={id,kind:'note',version:1,changes:{body:'Updated by explicit instruction'},requestKey:key,explicitWrite:true};
test('write tools reuse Book validation, require explicit command/current version and reject unknown, CRM or security fields',()=>{
 assert.equal(bookWriteTools.length,2);assert.equal(writeInput('update_book_entry',args).params.version,1);
 for(const patch of [{explicitWrite:false},{version:0},{kind:'journal'},{changes:{}},{changes:{owner_id:randomUUID()}},{changes:{password:'secret'}}])assert.throws(()=>writeInput('update_book_entry',{...args,...patch}));
 assert.throws(()=>writeInput('create_book_entry',{entry:{kind:'note',title:'Bad',version:1},requestKey:key,explicitWrite:true}));
});
test('OAuth writes require the feature flag, paired read scope and separate consent class; old default stays read-only',()=>{
 const p=new URLSearchParams({response_type:'code',client_id:'sboc_'+id,redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',scope:'note.read note.write',state:'s'.repeat(32),code_challenge:'c'.repeat(43),code_challenge_method:'S256',resource:oauthResource});
 assert.throws(()=>authorizationParameters(p));assert.deepEqual(authorizationParameters(p,{writeEnabled:true}).scopes,['note.read','note.write']);p.set('scope','note.read task.write');assert.throws(()=>authorizationParameters(p,{writeEnabled:true}));p.set('scope','note.read note.write note.create');assert.throws(()=>authorizationParameters(p,{writeEnabled:true,createEnabled:true}));
 assert.ok(!oauthMetadata('/.well-known/oauth-authorization-server').scopes_supported.includes('note.write'));assert.ok(oauthMetadata('/.well-known/oauth-authorization-server',{writeEnabled:true}).scopes_supported.includes('note.write'));
});
test('patch reads the authorized record, preserves unrequested fields and submits only requested normalized changes and a digest',async()=>{
 const calls=[],pool={query:async(q,a)=>{calls.push({q,a});return{rows:[{result:q.includes('oauth_machine')?{status:200,data:{id,kind:'note',title:'Keep title',body:'Old',priority:'high',status:'open',archived:false,dependencies:[],source_ref:'keep source',version:1}}:{status:200,data:{id,version:2}}}]};}};
 const r=await routeBookWrite({req:{headers:{authorization:'Bearer '+token}},name:'update_book_entry',args,sessionPool:pool,clientHash});assert.equal(r.status,200);assert.equal(calls.length,2);const payload=JSON.parse(calls[1].a[0]);assert.deepEqual(payload.params.changes,args.changes);assert.equal(payload.requestKey,key);assert.equal(payload.action,'patch');assert.ok(!JSON.stringify(calls).includes(token));assert.equal(payload.token_hash.length,64);
});
test('invalid write is authenticated/audited without storing rejected sensitive arguments',async()=>{
 const calls=[],sessionPool={query:async(q,a)=>{calls.push(JSON.parse(a[0]));return{rows:[{result:{status:403,data:{code:'BOOK_WRITE_SCOPE_REQUIRED'}}}]};}};
 await assert.rejects(routeBookWrite({req:{headers:{authorization:'Bearer '+token}},name:'update_book_entry',args:{...args,changes:{password:'FICTIONAL_SECRET'}},sessionPool,clientHash}));assert.equal(calls.length,1);assert.equal(calls[0].action,'invalid');assert.ok(!JSON.stringify(calls).includes('FICTIONAL_SECRET'));
});
test('MCP exposes writes only when explicitly enabled and requests only the actual missing resource scopes',async()=>{
 const request={method:'POST',headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream'}},base={req:request,url:new URL(oauthResource),clientHash,oauthEnabled:true,sessionPool:{query:async()=>({rows:[{result:{status:404,data:{}}}]})}};
 const tools=await routeBookMcp({...base,body:async()=>({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.ok(!tools.data.result.tools.some(t=>t.name==='create_book_entry'));
 const enabled=await routeBookMcp({...base,writeEnabled:true,body:async()=>({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(enabled.data.result.tools.length,5);assert.deepEqual(enabled.data.result.tools.at(-1).securitySchemes[0].scopes,['note.read']);
 const r=await routeBookMcp({...base,writeEnabled:true,sessionPool:{query:async()=>({rows:[{result:{status:403,data:{code:'BOOK_WRITE_SCOPE_REQUIRED'}}}]})},body:async()=>({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'create_book_entry',arguments:{entry:{kind:'note',title:'New'},requestKey:key,explicitWrite:true}}})});assert.equal(r.status,403);assert.match(r.headers['WWW-Authenticate'],/scope="note.read note.write"/);assert.ok(r.data.result._meta['mcp/www_authenticate']);
});
