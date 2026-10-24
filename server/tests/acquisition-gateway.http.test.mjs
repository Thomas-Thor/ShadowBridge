// HTTP smoke only. SQL/RLS are exercised by the separate real-Postgres harness.
import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,createHash}from'node:crypto';
import{createApp}from'../app.mjs';import{loadConfig}from'../config.mjs';import{createAcquisitionGateway}from'../acquisition-gateway.mjs';
function config(){const k=randomBytes(32).toString('hex');return loadConfig({APP_ENV:'test',APP_URL:'http://localhost',SUPABASE_URL:'http://localhost',SUPABASE_ANON_KEY:k,DATABASE_URL:'postgres://shadowbridge_api:'+k+'@localhost/test',SESSION_DATABASE_URL:'postgres://shadowbridge_sessions:'+k+'@localhost/test',SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64')});}
async function start(t,gateway){let dbCalls=0;const no=async()=>{dbCalls++;throw Error('Unexpected existing API database access');};const app=createApp({config:config(),db:{pool:{query:no},sessionPool:{query:no},close:async()=>{}},acquisitionGateway:gateway});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());return{base:'http://127.0.0.1:'+app.server.address().port,calls:()=>dbCalls};}
test('default runtime rejects machine API and retains existing CSRF for normal login',async t=>{
 const {base,calls}=await start(t);let r=await fetch(base+'/api/integrations/acquisition/v1/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,503);assert.equal((await r.json()).code,'ACQUISITION_DISABLED');
 r=await fetch(base+'/api/config');assert.equal(r.status,200);assert.equal(typeof(await r.json()).csrfToken,'string');
 r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.equal(calls(),0);
});
test('configured gateway requires scoped bearer, validates source, and never uses a browser session',async t=>{
 const token=randomBytes(32).toString('base64url');let guardedCalls=0;
 const gateway=createAcquisitionGateway({principals:[{provider:'apollo',tokenSha256:createHash('sha256').update(token).digest('hex')}],queryFactory:()=>({query:async()=>{guardedCalls++;return{rows:[{result:{decision:'already_complete',paidAllowed:false}}]};}})});
 const {base,calls}=await start(t,gateway),url=base+'/api/integrations/acquisition/v1/check';
 const payload={record:{company:{name:'FICTIONAL company',country:'NO'},contact:{fullName:'FICTIONAL person'},source:{system:'apollo',recordId:'test'}},companySourceId:'test-co',requiredFields:['workEmail']};
 const send=headers=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
 assert.equal((await send({})).status,401);assert.equal((await send({Authorization:'Bearer '+token,Cookie:'sb_session=not-owner'})).status,403);
 const r=await send({Authorization:'Bearer '+token});assert.equal(r.status,200);assert.equal((await r.json()).decision,'already_complete');assert.equal(guardedCalls,1);assert.equal(calls(),0);
});
