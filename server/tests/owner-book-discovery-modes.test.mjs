import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {oauthMetadata,authorizationParameters,oauthResource} from '../owner-book-oauth.mjs';
import {routeBookMcp} from '../owner-book-mcp.mjs';

const flags={createEnabled:true,writeEnabled:true};
const paths=['/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp'];
const authorize=scope=>new URLSearchParams({response_type:'code',client_id:'sboc_'+randomUUID(),redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',resource:oauthResource,code_challenge:'c'.repeat(43),code_challenge_method:'S256',state:'s'.repeat(32),scope});
async function list(options){
 const calls=[];
 const result=await routeBookMcp({req:{method:'POST',headers:{authorization:'Bearer sboa_'+randomBytes(32).toString('base64url'),accept:'application/json, text/event-stream'}},url:new URL(oauthResource),clientHash:'a'.repeat(64),oauthEnabled:true,...options,
  sessionPool:{query:async(q,a)=>{calls.push(q);assert.match(q,/owner_book\.oauth_machine/);assert.equal(a[0],'read');return{rows:[{result:{status:404,data:{}}}]};}},
  body:async()=>({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
 assert.equal(result.status,200);assert.equal(calls.length,1);
 return result.data.result.tools;
}

test('normal discovery never advertises temporary import scopes when both legacy flags are enabled',()=>{
 for(const path of paths){const scopes=oauthMetadata(path,flags).scopes_supported;
  assert.ok(scopes.includes('note.write'));assert.ok(scopes.includes('task.write'));
  assert.ok(!scopes.some(s=>s.endsWith('.create')));
  assert.doesNotThrow(()=>authorizationParameters(authorize(scopes.join(' ')),flags));
 }
});

test('normal tools and their security schemes cannot reintroduce temporary import scopes',async()=>{
 const tools=await list(flags);
 assert.deepEqual(tools.map(t=>t.name),['read_notes','read_book_entries','read_activity','create_book_entry','update_book_entry']);
 assert.ok(!tools.flatMap(t=>t.securitySchemes.flatMap(s=>s.scopes)).some(s=>s.endsWith('.create')));
 assert.ok(tools.slice(-2).every(t=>t.annotations.readOnlyHint===false));
});

test('separate import mode still advertises its existing seven tools and scopes without normal writes',async()=>{
 const options={createEnabled:true,writeEnabled:false};
 for(const path of paths){const scopes=oauthMetadata(path,options).scopes_supported;
  assert.ok(scopes.includes('note.create'));assert.ok(!scopes.some(s=>s.endsWith('.write')));
  assert.doesNotThrow(()=>authorizationParameters(authorize(scopes.join(' ')),options));
 }
 const tools=await list(options);
 for(const name of ['create_note','create_idea','create_task','create_event','create_decision','prepare_book_import','apply_book_import'])assert.ok(tools.some(t=>t.name===name));
 assert.ok(!tools.some(t=>t.name==='create_book_entry'||t.name==='update_book_entry'));
});

test('explicit four-scope write consent and separate import consent remain valid; mixed consent, bad PKCE and callbacks remain rejected',()=>{
 const scope='note.read note.write task.read task.write';
 assert.deepEqual(authorizationParameters(authorize(scope),flags).scopes,scope.split(' '));
 assert.deepEqual(authorizationParameters(authorize('note.read note.create'),flags).scopes,['note.read','note.create']);
 assert.throws(()=>authorizationParameters(authorize('note.read note.create note.write'),flags),/Temporary import and normal write consent must remain separate/);
 assert.throws(()=>authorizationParameters(authorize('note.read task.write'),flags),/matching read scope/);
 for(const [key,value]of [['code_challenge_method','plain'],['redirect_uri','https://attacker.invalid/']]){const p=authorize(scope);p.set(key,value);assert.throws(()=>authorizationParameters(p,flags));}
 const p=authorize(scope);p.delete('scope');assert.deepEqual(authorizationParameters(p,flags).scopes,['note.read']);
});

test('read-only mode and disabled flags never acquire write tools or scopes',async()=>{
 for(const options of [{},{createEnabled:false,writeEnabled:false}]){
  assert.ok(oauthMetadata(paths[0],options).scopes_supported.every(s=>s.endsWith('.read')));
  assert.ok((await list(options)).every(t=>t.annotations.readOnlyHint));
 }
});

test('existing separately consented import RPC remains callable while normal discovery is selected',async()=>{
 const queries=[];
 const result=await routeBookMcp({req:{method:'POST',headers:{authorization:'Bearer sboa_'+randomBytes(32).toString('base64url'),accept:'application/json, text/event-stream'}},url:new URL(oauthResource),clientHash:'a'.repeat(64),oauthEnabled:true,...flags,
  sessionPool:{query:async(q)=>{queries.push(q);assert.match(q,/owner_book\.append_rpc/);return{rows:[{result:{status:200,data:{created:false,reviewId:randomUUID()}}}]};}},
  body:async()=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_note',arguments:{entry:{title:'FICTIONAL separate import preview',source_ref:'fictional:discovery-test'},requestKey:randomUUID()}}})});
 assert.equal(queries.length,1);assert.equal(result.data.result.isError,false);assert.equal(result.data.result.structuredContent.created,false);
});
