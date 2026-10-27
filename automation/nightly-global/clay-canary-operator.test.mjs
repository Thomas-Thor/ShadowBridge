import test from 'node:test';import assert from 'node:assert/strict';import {buildClayCanary} from './build-clay-canary.mjs';import {installCanary,sendCanary,inspectCanary,reportFailure} from './clay-canary-operator.mjs';
function installFixture(){const state={},calls=[],profile={headerValue:'Bearer PRIVATE_FICTIONAL_INGEST_KEY'},template=buildClayCanary({spreadsheetId:'fictionalSpreadsheetIdentifier123456'});let workflow;
 const api=async(method,route,body)=>{calls.push({method,route,body});if(route.startsWith('/credentials?'))return{data:[{id:'google1',name:'Fictional Sheets account',type:'googleSheetsOAuth2Api',shared:[{id:'project1',name:'Fictional project',role:'credential:owner'}]}]};if(route.startsWith('/workflows?'))return{data:workflow?[{id:'workflow1',name:workflow.name}]:[]};if(route.startsWith('/credentials/schema/'))return{};if(route==='/credentials')return{id:'ingest1'};if(route==='/workflows'&&method==='POST'){workflow={...structuredClone(body),id:'workflow1',active:false,shared:[{projectId:body.projectId,role:'workflow:owner'}]};return{id:'workflow1'};}if(route.endsWith('/activate')){workflow.active=true;return{};}if(route==='/workflows/workflow1')return structuredClone(workflow);throw Error('UNEXPECTED');};
 return{state,calls,profile,template,googleCredentialId:'google1',projectId:'project1',api,save:async()=>{},current:()=>workflow};}
test('installer creates only one canary and one dedicated ingest credential, binds Google without extracting its token, and resumes without duplicate POSTs',async()=>{
 const f=installFixture(),r=await installCanary(f);assert.equal(r.status,'CANARY_RECEIVER_ACTIVE_NOT_SOURCING_VERIFIED');assert.equal(r.sourcingScheduled,false);assert.ok(!JSON.stringify(f.state).includes('PRIVATE_'));const posts=f.calls.filter(c=>c.method==='POST').length;await installCanary(f);assert.equal(f.calls.filter(c=>c.method==='POST').length,posts);assert.ok(f.current().nodes.filter(n=>n.credentials?.googleSheetsOAuth2Api).every(n=>n.credentials.googleSheetsOAuth2Api.id==='google1'));assert.ok(!f.calls.some(c=>/delete|execute|run|clay|sheet/i.test(c.route)));
});
test('project-scoped creation verifies secret-free Google metadata before POST and never creates a Google credential',async()=>{
 const f=installFixture(),r=await installCanary(f);assert.equal(r.projectId,'project1');assert.equal(r.googleCredentialMetadataVerified,true);assert.equal(r.workflowUrl,'https://automation.shadow-bridge.eu/workflow/workflow1');
 const posts=f.calls.filter(c=>c.method==='POST'&&['/credentials','/workflows'].includes(c.route));assert.equal(posts.length,2);assert.ok(posts.every(c=>c.body.projectId==='project1'));assert.equal(posts.find(c=>c.route==='/credentials').body.type,'httpHeaderAuth');
 for(const change of [c=>c.type='httpHeaderAuth',c=>c.shared=[],c=>c.shared=[{projectId:'project1'}],c=>c.data={unexpected:'NOT_A_REAL_TOKEN'}]){const v=installFixture(),real=v.api;v.api=async(m,p,b)=>{const r=await real(m,p,b);if(p.startsWith('/credentials?'))change(r.data[0]);return r;};await assert.rejects(installCanary(v));assert.equal(v.calls.filter(c=>c.method==='POST').length,0);}
 const v=installFixture();v.projectId=undefined;await assert.rejects(installCanary(v),/EXISTING_PROJECT/);assert.equal(v.calls.length,0);
});
test('wrong workflow project blocks publication and an existing project binding cannot be changed on resume',async()=>{
 const f=installFixture(),real=f.api;f.api=async(m,p,b)=>{const r=await real(m,p,b);if(p==='/workflows/workflow1')r.shared[0].projectId='other';return r;};await assert.rejects(installCanary(f),/PROJECT_NOT_CONFIRMED/);assert.ok(!f.calls.some(c=>c.route.endsWith('/activate')));
 f.projectId='other';await assert.rejects(installCanary(f),/PROJECT_CHANGED/);
});
test('a denied global list may use the authorized target metadata endpoint without new permissions or credentials',async()=>{
 const f=installFixture(),real=f.api;
 f.api=async(m,p,b)=>{if(p.startsWith('/credentials?'))throw Object.assign(Error('FORBIDDEN'),{httpStatus:403});if(p==='/credentials/google1')return{id:'google1',name:'Fictional Sheets account',type:'googleSheetsOAuth2Api'};return real(m,p,b);};
 const r=await installCanary(f);assert.equal(r.googleMetadataReadMode,'TARGET_ID_WITH_NATIVE_PROJECT_AND_GRAPH_CHECK');assert.equal(r.clayCredentialCandidates,null);assert.equal(f.current().shared[0].projectId,'project1');assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route==='/credentials').length,1);
 const v=installFixture(),before=v.api;v.api=async(m,p,b)=>{if(p.startsWith('/credentials'))throw Object.assign(Error('FORBIDDEN'),{httpStatus:403});return before(m,p,b);};await assert.rejects(installCanary(v));assert.equal(v.calls.filter(c=>c.method==='POST').length,0);
});
test('target-only metadata never permits publishing a graph whose Google binding was stripped by native validation',async()=>{
 const f=installFixture(),real=f.api;
 f.api=async(m,p,b)=>{if(p.startsWith('/credentials?'))throw Object.assign(Error('FORBIDDEN'),{httpStatus:403});if(p==='/credentials/google1')return{id:'google1',name:'Fictional Sheets',type:'googleSheetsOAuth2Api'};const r=await real(m,p,b);if(p==='/workflows/workflow1')delete r.nodes.find(n=>n.credentials?.googleSheetsOAuth2Api).credentials;return r;};
 await assert.rejects(installCanary(f),/GRAPH_DRIFT/);assert.ok(!f.calls.some(c=>c.route.endsWith('/activate')));
});
test('read-only inspection returns aggregates and rejects spending, leaked fields, impossible counts and forged schema-ready',async()=>{
 const batchId='fixture-read-only-0001',good={status:'CRM_READ_CONFIRMED',batchId,crmWrites:0,clayApiCalls:0,dataCreditsUsedByBridge:0,emailWritingSupported:false,sourcingScheduled:false,existingRows:3,legacyRows:0,duplicateIds:0,missingFields:[],ambiguousFields:[],canarySchemaReady:true,emailColumnPresent:true};
 const sent=[],r=await inspectCanary({batchId,call:async body=>{sent.push(body);return{...good,privateData:'FICTIONAL_NOT_RETURNED'};}});assert.deepEqual(sent,[{mode:'inspect',batchId,rows:[]}]);assert.equal(r.liveReadPerformed,true);assert.ok(!JSON.stringify(r).includes('FICTIONAL_NOT_RETURNED'));
 for(const change of [r=>r.crmWrites=1,r=>r.clayApiCalls=1,r=>r.batchId='other',r=>r.existingRows=-1,r=>r.missingFields=['SECRET_VALUE'],r=>r.legacyRows=1,r=>r.sourcingScheduled=true]){await assert.rejects(inspectCanary({batchId,call:async()=>{const r=structuredClone(good);change(r);return r;}}));}
});
test('failure report retains stage, HTTP status and actual workflow identity without exposing error bodies or secrets',()=>{
 const e=Object.assign(Error('PRIVATE_ERROR_TEXT_WITH_REALISTIC_SECRET=not-real'),{stage:'crm.read.only',httpStatus:403,workflowId:'fictionalWorkflow',body:{token:'FICTIONAL_PRIVATE'}});
 const r=reportFailure(e);assert.equal(r.stage,'crm.read.only');assert.equal(r.httpStatus,403);assert.equal(r.workflowUrl,'https://automation.shadow-bridge.eu/workflow/fictionalWorkflow');assert.equal(r.checkpointRetained,true);assert.ok(!JSON.stringify(r).includes('PRIVATE_ERROR_TEXT'));assert.ok(!JSON.stringify(r).includes('FICTIONAL_PRIVATE'));assert.equal(r.reason,'CANARY_INTERRUPTED_CHECK_PRIVATE_CHECKPOINT');
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
