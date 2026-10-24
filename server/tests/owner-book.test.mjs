import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID,randomBytes,createHash}from'node:crypto';import{readFile}from'node:fs/promises';
import{bookRecord,importRecords,bookOperation,routeOwnerBook,routeBookToken,bookScopes}from'../owner-book.mjs';
import{ownerBookContract}from'../../scripts/owner-book-contract.mjs';import{archiveHasBook,restoredBookRolesSql}from'../../scripts/book-recovery-roles.mjs';
const entry=()=>({kind:'task',title:'FICTIONAL work',body:'Fictional operational context',priority:'high',status:'open'});
test('entry API rejects ownership, security and executable structure injection; dates carry explicit offsets',()=>{
 for(const name of ['owner_id','role','tokenHash','password','source_label'])assert.throws(()=>bookRecord({...entry(),[name]:'injected'}));
 assert.throws(()=>bookRecord({...entry(),due_at:'2026-10-25T02:30'}));
 assert.equal(bookRecord({...entry(),due_at:'2026-10-25T02:30:00+02:00'}).due_at,'2026-10-25T00:30:00.000Z');
 assert.throws(()=>bookRecord({kind:'event',title:'Missing start'}));assert.throws(()=>bookRecord({kind:'note',title:'Invalid dependencies',dependencies:[randomUUID()]}));
});
test('known secret formats are rejected in notes and source references, without echoing values',()=>{
 const secret='sbob_'+randomBytes(32).toString('base64url');for(const field of ['body','source_ref'])assert.throws(()=>bookRecord({...entry(),[field]:secret}),e=>!e.message.includes(secret));
});
test('bounded import never accepts existing IDs, malformed JSON, owner grants or oversized notes',()=>{
 assert.equal(importRecords({format:'text',content:'FICTIONAL earlier agreement'}).length,1);
 assert.throws(()=>importRecords({format:'text',content:'x'.repeat(5001)}));assert.throws(()=>importRecords({format:'json',content:'{' }));
 assert.throws(()=>importRecords({items:[{...entry(),id:randomUUID()}]}));assert.throws(()=>importRecords({items:Array.from({length:26},entry)}));
});
test('read-only key mode cannot acquire write scopes, and limited admin remains book-only',()=>{
 const url=new URL('https://shadow-bridge.eu/api/owner/book/keys');
 assert.throws(()=>bookOperation(url,'POST',{name:'test',mode:'read_only',scopes:['task.write'],expiresAt:'2027-01-01T00:00:00Z'}));
 const op=bookOperation(url,'POST',{name:'test',mode:'book_admin',scopes:[],expiresAt:'2027-01-01T00:00:00Z'});assert.deepEqual(op.p.scopes,[...bookScopes]);
 assert.ok(bookScopes.every(s=>!/(vault|bank|account|key|staff|crm)/.test(s)));
});
test('one-time key is returned only after authorization commits; database receives its hash, never plaintext',async()=>{
 let args;const tx={query:async(q,v)=>{args=v;return{rows:[{result:{status:200,data:{id:randomUUID()}}}]};}};
 const req={method:'POST'},url=new URL('https://shadow-bridge.eu/api/owner/book/keys'),body=async()=>({name:'FICTIONAL assistant',mode:'read_only',expiresAt:'2027-01-01T00:00:00Z'});
 const r=await routeOwnerBook({req,url,tx,body,config:{}});assert.match(r.data.token,/^sbob_[A-Za-z0-9_-]{43}$/);assert.equal(JSON.parse(args[2]).tokenHash,createHash('sha256').update(r.data.token).digest('hex'));assert.ok(!JSON.stringify(args).includes(r.data.token));
 const denied=await routeOwnerBook({req,url,tx:{query:async()=>({rows:[{result:{status:403,data:{code:'OWNER_REQUIRED'}}}]})},body,config:{}});assert.equal(denied.data.token,undefined);
});
test('machine API hashes the key and requires one matching explicit command ID for writes',async()=>{
 const raw='sbob_'+randomBytes(32).toString('base64url'),command=randomUUID(),calls=[];
 const sessionPool={query:async(q,args)=>{calls.push(args);return{rows:[{result:{status:args[1]==='invalid'?403:200,data:{ok:true}}}]};}};
 const req={method:'POST',headers:{authorization:'Bearer '+raw,'x-shadowbridge-command-id':command,'x-shadowbridge-explicit-write':'true'}},url=new URL('https://shadow-bridge.eu/api/integrations/owner-book/v1/entries');
 await routeBookToken({req,url,sessionPool,body:async()=>({entry:entry(),requestKey:command}),clientHash:'a'.repeat(64)});
 assert.equal(calls[0][0],createHash('sha256').update(raw).digest('hex'));assert.equal(calls[0][5],true);assert.equal(calls[0][4],command);assert.ok(!JSON.stringify(calls).includes(raw));
 await assert.rejects(routeBookToken({req:{...req,headers:{...req.headers,cookie:'owner-session-not-used'}},url,sessionPool,body:async()=>({entry:entry(),requestKey:command}),clientHash:'a'.repeat(64)}),e=>e.status===403);
});
test('OpenAPI default is GET only; writes require confirmation and never describe key, CRM or password access',async()=>{
 for(const write of [false,true]){const c=ownerBookContract({write}),file=JSON.parse(await readFile(new URL('../../docs/owner-book.'+(write?'custom':'readonly')+'.openapi.json',import.meta.url),'utf8'));assert.deepEqual(c,file);
  for(const [path,methods]of Object.entries(c.paths)){assert.ok(!/(keys|vault|crm|bank)/.test(path));for(const [method,op]of Object.entries(methods)){if(!write)assert.equal(method,'get');if(method!=='get'){assert.equal(op['x-openai-isConsequential'],true);assert.ok(op.parameters.some(p=>p.name==='X-ShadowBridge-Explicit-Write'&&p.required));}}}
 }
});
test('recovery creates only a non-login, non-BYPASSRLS role on an empty target',()=>{
 assert.equal(archiveHasBook('123; 2615 100 SCHEMA - owner_book postgres\n'),true);assert.equal(archiveHasBook('123; 1 1 TABLE other owner_book postgres\n'),false);
 assert.match(restoredBookRolesSql,/NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS/);assert.match(restoredBookRolesSql,/current_database\(\)<>'shadowbridge'/);assert.match(restoredBookRolesSql,/to_regnamespace\('sb'\) IS NOT NULL/);assert.ok(!/DROP|TRUNCATE|DELETE|PASSWORD/i.test(restoredBookRolesSql));
});
