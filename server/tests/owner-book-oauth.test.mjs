import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import{randomBytes,createHash}from'node:crypto';
import{routeOAuth,oauthResource,oauthPrefix,oauthChallenge,authorizationParameters,sealConsent,openConsent,oauthMetadata}from'../owner-book-oauth.mjs';
import{createAuthService}from'../auth.mjs';import{routeBookMcp,mcpPath}from'../owner-book-mcp.mjs';import{bookRecord}from'../owner-book.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const clientId='sboc_11111111-1111-4111-8111-111111111111',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const verifier=randomBytes(32).toString('base64url'),parameters=()=>new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,scope:'note.read',state:randomBytes(24).toString('base64url'),resource:oauthResource,code_challenge:hash(verifier).slice(0,43),code_challenge_method:'S256'});
async function setup(t,{enabled=true,owner=true,create=false,write=false}={}){
 const key=randomBytes(32),config={appUrl:'http://localhost',sessionEncryptionKey:key,sessionLifetimeSeconds:3600,ownerBookApiEnabled:true,ownerBookMcpEnabled:true,ownerBookOAuthEnabled:enabled,ownerBookMcpCreateEnabled:create,ownerBookMcpWriteEnabled:write,secureCookies:false};
 const calls=[];let issued=false;
 const db={sessionPool:{query:async(q,a)=>{calls.push({q,a});assert.ok(q.includes('owner_book.oauth_machine'));const p=JSON.parse(a[1]);return{rows:[{result:a[0]==='client'?{status:200,data:{name:'FICTIONAL <client>',redirects:[redirect]}}:a[0]==='read'?{status:200,data:{items:[{id:'FICTIONAL',kind:'note',title:'TEST-CONNECTION-NOTE',body:'FICTIONAL',owner_id:'HIDDEN'}],page:1,limit:25,total:1}}:{status:200,data:{scope:'note.read',expires_in:600}}}]};}},asUser:async(identity,opt,fn)=>fn({query:async(q,a)=>{calls.push({q,a});assert.ok(q.includes('oauth_owner'));return{rows:[{result:owner?{status:200,data:a[0]==='connections'?{items:[]}:a[0]==='authorize'?{authorized:!issued&&(issued=true)}:{eligible:true}}:{status:403,data:{code:'OWNER_MFA_REQUIRED'}}}]};}})};
 const real=createAuthService({config,db}),auth={...real,authenticate:async()=>owner?{id:'fictional-owner',aal:'aal2',emailVerified:true,recoveryOnly:false}:null};
 const body=async req=>{let value='';for await(const p of req)value+=p;return JSON.parse(value);};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,config.appUrl);if(url.pathname===mcpPath){const r=await routeBookMcp({req,url,sessionPool:db.sessionPool,body,clientHash:'a'.repeat(64),oauthEnabled:true,createEnabled:create,writeEnabled:write});res.writeHead(r.status,{...r.headers,'Content-Type':'application/json'});return res.end(JSON.stringify(r.data));}await routeOAuth({req,res,url,config,db,auth,body,clientHash:'a'.repeat(64),limit:()=>{}});}catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:e.code||'PRIVATE_ERROR'}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 return{base,calls,key,auth,post:(path,p,headers={})=>fetch(base+oauthPrefix+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(p)})};
}
test('OAuth discovery advertises exact issuer/resource, S256 and registration; it does not advertise writes or implicit/password grants',()=>{
 const m=oauthMetadata('/.well-known/oauth-authorization-server');assert.equal(m.issuer,'https://shadow-bridge.eu');assert.deepEqual(m.code_challenge_methods_supported,['S256']);assert.deepEqual(m.grant_types_supported,['authorization_code','refresh_token']);assert.ok(m.scopes_supported.every(s=>s.endsWith('.read')));assert.equal(oauthMetadata('/.well-known/oauth-protected-resource').resource,oauthResource);assert.match(oauthChallenge,/resource_metadata=/);
});
test('real loopback HTTP discovery with both flags advertises one consent class and clients can authorize advertised scopes without mixed-scope rejection',async t=>{
 const f=await setup(t,{create:true,write:true});
 for(const path of ['/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp']){
  const response=await fetch(f.base+path);assert.equal(response.status,200);const scopes=(await response.json()).scopes_supported;
  assert.ok(scopes.includes('note.write')&&scopes.includes('task.write'));assert.ok(!scopes.some(s=>s.endsWith('.create')));
  const p=parameters();p.set('scope',scopes.join(' '));const page=await fetch(f.base+oauthPrefix+'/authorize?'+p);
  assert.equal(page.status,200);assert.match(await page.text(),/Create and edit Book entries/);
 }
 const response=await fetch(f.base+mcpPath,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer sboa_'+randomBytes(32).toString('base64url')},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).result.tools.map(x=>x.name),['read_notes','read_book_entries','read_activity','create_book_entry','update_book_entry']);
 const mixed=parameters();mixed.set('scope','note.read note.create note.write');
 const denied=await fetch(f.base+oauthPrefix+'/authorize?'+mixed);assert.equal(denied.status,400);assert.equal((await denied.json()).code,'OAUTH_REQUEST_REJECTED');
});
test('exact note/task OAuth consent still needs fresh OWNER context, CSRF and separate explicit write approval and never adds import scopes',async t=>{
 const f=await setup(t,{create:true,write:true}),p=parameters();p.set('scope','note.read note.write task.read task.write');
 const r=await fetch(f.base+oauthPrefix+'/authorize?'+p),page=await r.text(),cookie=r.headers.get('set-cookie').split(';')[0],ticket=page.match(/id="oauth-ticket" type="hidden" value="([^"]+)/)[1];
 assert.match(page,/Create and edit Book entries/);assert.match(page,/<input id="oauth-write-consent" type="checkbox">/);assert.ok(!page.includes('id="oauth-create-consent"'));
 const context=await fetch(f.base+oauthPrefix+'/context'),csrfCookie=context.headers.get('set-cookie').split(';')[0],d=await context.json();
 const headers={Origin:'http://localhost',Cookie:cookie+'; '+csrfCookie,'X-CSRF-Token':d.csrfToken,'X-Session-Token':d.csrfToken};
 assert.equal((await f.post('/consent',{ticket,approve:true},headers)).status,403);
 assert.equal((await f.post('/consent',{ticket,approve:true,explicitWriteConsent:true},{...headers,'X-CSRF-Token':'invalid'})).status,403);
 assert.ok(!f.calls.some(c=>c.a[0]==='authorize'));
 assert.equal((await f.post('/consent',{ticket,approve:true,explicitWriteConsent:true},headers)).status,200);
 const granted=JSON.parse(f.calls.find(c=>c.a[0]==='authorize').a[1]);assert.deepEqual(granted.scopes,['note.read','note.write','task.read','task.write']);assert.equal(granted.explicitWriteConsent,true);assert.ok(!granted.temporaryCreateConsent);
 const denied=await setup(t,{owner:false,create:true,write:true});assert.equal((await fetch(denied.base+oauthPrefix+'/context')).status,403);assert.equal(denied.calls.length,0);
});
test('authorization rejects arbitrary/partial callback matches, duplicate fields, wrong resource, plain PKCE, missing state and write scope',()=>{
 assert.deepEqual(authorizationParameters(parameters()).scopes,['note.read']);
 for(const [key,value]of [['redirect_uri',redirect+'/evil'],['redirect_uri','https://attacker.invalid/'],['resource','https://another.invalid/mcp'],['code_challenge_method','plain'],['scope','note.write'],['state','short']]){const p=parameters();p.set(key,value);assert.throws(()=>authorizationParameters(p));}
 const duplicate=parameters();duplicate.append('client_id',clientId);assert.throws(()=>authorizationParameters(duplicate));
});
test('consent ticket cannot be tampered with, reused in a different browser, or used after expiry',()=>{
 const key=randomBytes(32),nonce=randomBytes(32).toString('base64url'),p={nonce_hash:hash(nonce),expires:Date.now()+10000};const ticket=sealConsent(p,key);assert.deepEqual(openConsent(ticket,key,nonce),p);
 for(const t of [ticket+'x',sealConsent({...p,expires:Date.now()-1},key),sealConsent({...p,nonce_hash:hash('other')},key)])assert.throws(()=>openConsent(t,key,nonce));assert.throws(()=>openConsent(ticket,randomBytes(32),nonce));
});
test('real HTTP discovery is disabled independently; registration rejects unknown callbacks and write grants without a SQL call',async t=>{
 const off=await setup(t,{enabled:false});assert.equal((await fetch(off.base+'/.well-known/oauth-authorization-server')).status,503);assert.equal(off.calls.length,0);
 const f=await setup(t);assert.equal((await fetch(f.base+'/.well-known/oauth-protected-resource')).status,200);
 for(const p of [{redirect_uris:['https://attacker.invalid/']},{redirect_uris:[redirect],grant_types:['password']},{redirect_uris:[redirect],scope:'note.write'},{redirect_uris:[redirect],scope:123}])assert.equal((await f.post('/register',p)).status,400);assert.equal(f.calls.length,0);
 const r=await f.post('/register',{redirect_uris:[redirect],client_name:'ChatGPT',token_endpoint_auth_method:'none'});assert.equal(r.status,201);const d=await r.json();assert.ok(!d.client_secret);assert.match(d.client_id,/^sboc_/);
});
test('consent page escapes client metadata and binds an HttpOnly cookie; unauthorized OWNER and CSRF failures cannot issue a code',async t=>{
 const f=await setup(t),r=await fetch(f.base+oauthPrefix+'/authorize?'+parameters());assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);const page=await r.text();assert.ok(page.includes('&lt;client&gt;'));assert.ok(!page.includes('<client>'));
 const ticket=page.match(/id="oauth-ticket" type="hidden" value="([^"]+)/)[1];
 const denied=await f.post('/consent',{ticket,approve:true},{Origin:'https://attacker.invalid'});assert.equal(denied.status,403);assert.ok(!f.calls.some(c=>c.a[0]==='authorize'));
 const absent=await setup(t,{owner:false});assert.equal((await fetch(absent.base+oauthPrefix+'/context')).status,403);assert.equal(absent.calls.length,0);
});
test('valid browser consent uses normal CSRF and the existing owner transaction contract; signed client data cannot be altered by the browser',async t=>{
 const f=await setup(t),r=await fetch(f.base+oauthPrefix+'/authorize?'+parameters()),page=await r.text(),cookie=r.headers.get('set-cookie').split(';')[0],ticket=page.match(/id="oauth-ticket" type="hidden" value="([^"]+)/)[1];
 const context=await fetch(f.base+oauthPrefix+'/context'),csrfCookie=context.headers.get('set-cookie').split(';')[0],d=await context.json();
 const result=await f.post('/consent',{ticket,approve:true},{Origin:'http://localhost',Cookie:cookie+'; '+csrfCookie,'X-CSRF-Token':d.csrfToken,'X-Session-Token':d.csrfToken});assert.equal(result.status,200);const target=new URL((await result.json()).redirect);assert.equal(target.origin+target.pathname,redirect);assert.ok(target.searchParams.get('code').startsWith('sbocc_'));assert.equal(target.searchParams.get('iss'),'https://shadow-bridge.eu');
 const call=f.calls.find(c=>c.a[0]==='authorize');assert.ok(call);assert.ok(!JSON.stringify(call).includes(target.searchParams.get('code')));assert.equal(JSON.parse(call.a[1]).resource,oauthResource);
});
test('real form token requests require PKCE, resource, registered callback and client authentication; secrets are hashed before SQL',async t=>{
 const f=await setup(t),post=p=>fetch(f.base+oauthPrefix+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(p)}),p={grant_type:'authorization_code',client_id:clientId,code:'sbocc_'+randomBytes(32).toString('base64url'),code_verifier:verifier,redirect_uri:redirect,resource:oauthResource};
 assert.equal((await post({...p,resource:'https://other.invalid/'})).status,400);assert.equal((await post({...p,code_verifier:'short'})).status,400);assert.equal((await post({...p,scope:'note.write'})).status,400);assert.equal(f.calls.length,0);
 const secret=randomBytes(32).toString('base64url'),r=await post({...p,client_secret:secret});assert.equal(r.status,200);const data=await r.json();assert.match(data.access_token,/^sboa_/);assert.match(data.refresh_token,/^sbor_/);assert.equal(data.scope,'note.read');assert.ok(!JSON.stringify(f.calls).includes(secret));assert.ok(!JSON.stringify(f.calls).includes(data.access_token));assert.equal(JSON.parse(f.calls[0].a[1]).challenge,createHash('sha256').update(verifier).digest('base64url'));
});
test('OAuth bearer is accepted only on scoped MCP reads; projection hides identity and metadata advertises no write tool',async t=>{
 const f=await setup(t),r=await fetch(f.base+mcpPath,{method:'POST',headers:{Authorization:'Bearer sboa_'+randomBytes(32).toString('base64url'),'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_notes',arguments:{}}})});assert.equal(r.status,200);const d=await r.json();assert.equal(d.result.structuredContent.items[0].title,'TEST-CONNECTION-NOTE');assert.ok(!JSON.stringify(d).includes('HIDDEN'));assert.equal(f.calls[0].a[0],'read');
});

test('temporary OAuth additions require a separate unchecked consent and server-side boolean after existing OWNER/MFA and CSRF',async t=>{
 const f=await setup(t,{create:true}),p=parameters();p.set('scope','note.read note.create');const r=await fetch(f.base+oauthPrefix+'/authorize?'+p),page=await r.text();assert.equal(r.status,200);assert.ok(page.includes('id="oauth-create-consent"'));assert.ok(!page.includes('id="oauth-create-consent" type="checkbox" checked'));
 const ticket=page.match(/id="oauth-ticket" type="hidden" value="([^"]+)/)[1],cookie=r.headers.get('set-cookie').split(';')[0],context=await fetch(f.base+oauthPrefix+'/context'),csrfCookie=context.headers.get('set-cookie').split(';')[0],d=await context.json(),headers={Origin:'http://localhost',Cookie:cookie+'; '+csrfCookie,'X-CSRF-Token':d.csrfToken,'X-Session-Token':d.csrfToken};
 assert.equal((await f.post('/consent',{ticket,approve:true},headers)).status,403);assert.ok(!f.calls.some(c=>c.a[0]==='authorize'));
 assert.equal((await f.post('/consent',{ticket,approve:true,temporaryCreateConsent:true},headers)).status,200);assert.equal(JSON.parse(f.calls.find(c=>c.a[0]==='authorize').a[1]).temporaryCreateConsent,true);
});
test('write OAuth consent is separate, unchecked, CSRF-protected and can be cancelled without granting write',async t=>{
 const f=await setup(t,{write:true}),p=parameters();p.set('scope','note.read note.write');const r=await fetch(f.base+oauthPrefix+'/authorize?'+p),page=await r.text();assert.equal(r.status,200);assert.ok(page.includes('id="oauth-write-consent"'));assert.ok(page.includes('Create and edit Book entries'));assert.ok(!page.includes('id="oauth-write-consent" type="checkbox" checked'));
 const ticket=page.match(/id="oauth-ticket" type="hidden" value="([^"]+)/)[1],cookie=r.headers.get('set-cookie').split(';')[0],context=await fetch(f.base+oauthPrefix+'/context'),csrfCookie=context.headers.get('set-cookie').split(';')[0],d=await context.json(),headers={Origin:'http://localhost',Cookie:cookie+'; '+csrfCookie,'X-CSRF-Token':d.csrfToken,'X-Session-Token':d.csrfToken};
 assert.equal((await f.post('/consent',{ticket,approve:true},headers)).status,403);assert.ok(!f.calls.some(c=>c.a[0]==='authorize'));
 const denied=await f.post('/consent',{ticket,approve:false},headers);assert.equal(denied.status,200);assert.equal(new URL((await denied.json()).redirect).searchParams.get('error'),'access_denied');assert.ok(!f.calls.some(c=>c.a[0]==='authorize'));
 assert.equal((await f.post('/consent',{ticket,approve:true,explicitWriteConsent:true},headers)).status,200);assert.equal(JSON.parse(f.calls.find(c=>c.a[0]==='authorize').a[1]).explicitWriteConsent,true);
});
