import test from 'node:test';import assert from 'node:assert/strict';import {buildClayCanary} from './build-clay-canary.mjs';import {installCanary,sendCanary} from './clay-canary-operator.mjs';
function installFixture(){const state={},calls=[],profile={headerValue:'Bearer PRIVATE_FICTIONAL_INGEST_KEY'},template=buildClayCanary({spreadsheetId:'fictionalSpreadsheetIdentifier123456'});let workflow;
 const api=async(method,route,body)=>{calls.push({method,route});if(route.startsWith('/workflows?'))return{data:workflow?[{id:'workflow1',name:workflow.name}]:[]};if(route.startsWith('/credentials/schema/'))return{};if(route==='/credentials')return{id:'ingest1'};if(route==='/workflows'&&method==='POST'){workflow={...structuredClone(body),id:'workflow1',active:false};return{id:'workflow1'};}if(route.endsWith('/activate')){workflow.active=true;return{};}if(route==='/workflows/workflow1')return structuredClone(workflow);throw Error('UNEXPECTED');};
 return{state,calls,profile,template,googleCredentialId:'google1',api,save:async()=>{},current:()=>workflow};}
test('installer creates only one canary and one dedicated ingest credential, binds Google without extracting its token, and resumes without duplicate POSTs',async()=>{
 const f=installFixture(),r=await installCanary(f);assert.equal(r.status,'CANARY_RECEIVER_ACTIVE_NOT_SOURCING_VERIFIED');assert.equal(r.sourcingScheduled,false);assert.ok(!JSON.stringify(f.state).includes('PRIVATE_'));const posts=f.calls.filter(c=>c.method==='POST').length;await installCanary(f);assert.equal(f.calls.filter(c=>c.method==='POST').length,posts);assert.ok(f.current().nodes.filter(n=>n.credentials?.googleSheetsOAuth2Api).every(n=>n.credentials.googleSheetsOAuth2Api.id==='google1'));assert.ok(!f.calls.some(c=>/delete|execute|run|clay|sheet/i.test(c.route)));
});
test('lost credential/workflow POST receipts are never automatically repeated',async()=>{
 for(const route of ['/credentials','/workflows']){const f=installFixture(),real=f.api;let posts=0;f.api=async(m,p,b)=>{const r=await real(m,p,b);if(m==='POST'&&p===route){posts++;throw Error('LOST_RECEIPT');}return r;};await assert.rejects(installCanary(f));await assert.rejects(installCanary(f));assert.equal(posts,1);}
});
test('activation response loss can be confirmed by GET without activating twice; manual graph edits block updates',async()=>{
 const f=installFixture(),real=f.api;f.api=async(m,p,b)=>{const r=await real(m,p,b);if(p.endsWith('/activate'))throw Error('LOST_RECEIPT');return r;};await assert.rejects(installCanary(f));await installCanary(f);assert.equal(f.calls.filter(c=>c.route.endsWith('/activate')).length,1);f.current().nodes[1].name='MANUAL EDIT';await assert.rejects(installCanary(f),/GRAPH_DRIFT/);
});
const payload={mode:'preview',batchId:'fictional-batch-00001',rows:[{company:'FICTIONAL',country:'NO',website:'fictional.example.invalid'}]};
const receipt=(status='CANARY_CRM_READBACK_CONFIRMED')=>({status,batchId:payload.batchId,sourceRows:1,rowsAppended:status==='READBACK_CONFIRMED'?0:1,duplicateRows:0,confirmedUniqueRows:1,emailAddressesCollected:0,phoneNumbersCollected:0,clayApiCalls:0,dataCreditsUsedByBridge:0,privateData:'MUST_NOT_RETURN'});
test('send previews then appends once; only sanitized aggregates persist and a cached receipt is labelled',async()=>{
 const calls=[],state={},call=async p=>{calls.push(p.mode);return p.mode==='preview'?{status:'PREVIEW_ONLY',batchId:p.batchId,sourceRows:1,crmWrites:0,rowsToAppend:1}:receipt();};const args={call,payload,state,save:async()=>{}};
 const r=await sendCanary(args);assert.deepEqual(calls,['preview','append']);assert.equal(r.liveReadPerformed,true);assert.ok(!JSON.stringify(state).includes('MUST_NOT_RETURN'));const cached=await sendCanary(args);assert.equal(cached.receiptReused,true);assert.equal(cached.liveReadPerformed,false);assert.equal(calls.length,2);
});
test('a timeout after append preserves uncertainty and next invocation performs verification only',async()=>{
 const state={},calls=[];let fail=true;const call=async p=>{calls.push(p.mode);if(p.mode==='preview')return{status:'PREVIEW_ONLY',batchId:p.batchId,sourceRows:1,crmWrites:0,rowsToAppend:1};if(fail){fail=false;throw Error('TIMEOUT');}return receipt('READBACK_CONFIRMED');};const args={call,payload,state,save:async()=>{}};
 await assert.rejects(sendCanary(args));assert.equal(state.phase,'UNCERTAIN');await sendCanary(args);assert.deepEqual(calls,['preview','append','verify']);assert.equal(state.phase,'VERIFIED');
});
test('wrong batch receipt, nonzero email/credit claims, and a failed preview never become verified',async()=>{
 for(const change of [r=>r.batchId='wrong',r=>r.emailAddressesCollected=1,r=>r.dataCreditsUsedByBridge=1]){const state={},call=async p=>{if(p.mode==='preview')return{status:'PREVIEW_ONLY',batchId:p.batchId,sourceRows:1,crmWrites:0,rowsToAppend:1};const r=receipt();change(r);return r;};await assert.rejects(sendCanary({call,payload,state,save:async()=>{}}));assert.equal(state.phase,'UNCERTAIN');}
 const modes=[];await assert.rejects(sendCanary({call:async p=>{modes.push(p.mode);return{status:'BLOCKED'};},payload,state:{},save:async()=>{}}));assert.deepEqual(modes,['preview']);
});
