import test from 'node:test';import assert from 'node:assert/strict';import {buildClayCanary} from './build-clay-canary.mjs';import {installCanary,sendCanary,inspectCanary,reportFailure} from './clay-canary-operator.mjs';
import {authorizeRejectedIngress} from './n8n-reconcile-ingress.mjs';
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
test('explicit OWNER-provided binding uses no denied metadata endpoints and preserves native project and graph validation',async()=>{
 const f=installFixture();f.ownerProvidedBinding=true;for(const n of f.template.nodes)if(n.credentials?.googleSheetsOAuth2Api)n.credentials.googleSheetsOAuth2Api.id='google1';const real=f.api;
 f.api=async(m,p,b)=>{assert.ok(!(m==='GET'&&p.startsWith('/credentials')),'No credential GET required');return real(m,p,b);};
 const r=await installCanary(f);assert.equal(r.googleCredentialMetadataVerified,false);assert.equal(r.googleMetadataReadMode,'OWNER_PROVIDED_ID_NATIVE_PROJECT_AND_GRAPH_VERIFIED');assert.equal(r.googleCredentialPermissionVerified,false);assert.equal(r.projectId,'project1');
 const posts=f.calls.filter(c=>c.method==='POST').length;await installCanary(f);assert.equal(f.calls.filter(c=>c.method==='POST').length,posts);
});
test('known binding never weakens native rejection, accepts a placeholder or activates a credential stripped by n8n',async()=>{
 for(const failure of ['placeholder','native403','stripped','project']){
  const f=installFixture();f.ownerProvidedBinding=true;if(failure!=='placeholder')for(const n of f.template.nodes)if(n.credentials?.googleSheetsOAuth2Api)n.credentials.googleSheetsOAuth2Api.id='google1';const real=f.api;
  f.api=async(m,p,b)=>{if(failure==='native403'&&m==='POST'&&p==='/workflows')throw Object.assign(Error('Forbidden'),{httpStatus:403});const r=await real(m,p,b);if(p==='/workflows/workflow1'){if(failure==='stripped')delete r.nodes.find(n=>n.credentials?.googleSheetsOAuth2Api).credentials;if(failure==='project')r.shared[0].projectId='other';}return r;};
  await assert.rejects(installCanary(f));assert.ok(!f.calls.some(c=>c.route.endsWith('/activate')));
 }
});
test('native normalization of the known header credential label resumes the same workflow without recreating or updating it',async()=>{
 const f=installFixture(),real=f.api;f.api=async(m,p,b)=>{const r=await real(m,p,b);if(m==='POST'&&p==='/workflows')f.current().nodes[0].credentials.httpHeaderAuth.name='ShadowBridge private Clay intake';return r;};
 await installCanary(f);assert.equal(f.state.graphComparison.knownDisplayLabelNormalizations.length,1);assert.equal(f.state.graphComparison.differenceCount,0);const originalHash=f.state.expectedWorkflowHash;
 const before=f.calls.filter(c=>c.method==='POST'&&['/credentials','/workflows'].includes(c.route)).length;await installCanary(f);assert.equal(f.calls.filter(c=>c.method==='POST'&&['/credentials','/workflows'].includes(c.route)).length,before);assert.equal(f.state.expectedWorkflowHash,originalHash);assert.ok(!f.calls.some(c=>c.method==='PUT'||c.method==='PATCH'));assert.equal(f.current().nodes[0].credentials.httpHeaderAuth.name,'ShadowBridge private Clay intake');
});
test('unapproved server changes still stop before activation and failure includes only redacted graph evidence',async()=>{
 const f=installFixture(),real=f.api;f.api=async(m,p,b)=>{const r=await real(m,p,b);if(m==='POST'&&p==='/workflows'){f.current().nodes[0].credentials.httpHeaderAuth.name='ShadowBridge private Clay intake';f.current().nodes[1].parameters.jsCode='PRIVATE_CHANGED_CODE';}return r;};
 let failure;try{await installCanary(f);}catch(e){failure=e;}assert.equal(failure.message,'CANARY_GRAPH_DRIFT_NO_UPDATE');assert.equal(failure.stage,'workflow.graph.verify');const r=reportFailure(failure);assert.equal(r.graphDiff.redacted,true);assert.ok(!JSON.stringify(r).includes('PRIVATE_CHANGED_CODE'));assert.ok(r.graphDiff.differenceCount>0);assert.ok(!f.calls.some(c=>c.route.endsWith('/activate')));
});
function rejectedFixture(){
 const f=installFixture();f.ownerProvidedBinding=true;for(const n of f.template.nodes)if(n.credentials?.googleSheetsOAuth2Api)n.credentials.googleSheetsOAuth2Api.id='google1';Object.assign(f.state,{templateSha:'a'.repeat(64),projectId:'project1',googleCredentialId:'google1',ingestCredential:{sending:true}});
 const requestId='12345678-1234-1234-1234-123456789abc',evidence={kind:'shadowbridge-n8n-credential-create-permission-metadata',status:'METADATA_READ_ONLY_CONFIRMED',readOnly:true,changesMade:false,apiWrites:0,providerCalls:0,crmWrites:0,operatorRequestId:requestId,observedAt:new Date().toISOString(),exactExistingKeyIdentified:true,keyOwnerDisabled:false,configuredScopeChecks:Object.fromEntries(['credential:create','workflow:list','workflow:read','workflow:create','workflow:activate'].map(s=>[s,true])),targetProjectId:'project1',selectedGoogleCredential:{id:'google1',type:'googleSheetsOAuth2Api'},googleCredentialSharedWithTarget:true,keyOwnerTargetProjectMembershipExists:true,keyOwnerTargetProjectRole:'project:personalOwner',matchingIngressCredentials:0,matchingWorkflowCount:0};
 f.ingressRetryAuthorization={...authorizeRejectedIngress({state:f.state,evidence,requestId,ownerApproval:true}),checkpointBackupCreated:true,checkpointBeforeHash:'b'.repeat(64)};return f;
}
test('one verified rejected ingress may be retried with retained history; receipts prevent duplicate creation',async()=>{
 const f=rejectedFixture(),snapshots=[];f.save=async s=>snapshots.push(structuredClone(s));await installCanary(f);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route==='/credentials').length,1);assert.equal(f.state.ingressRejectedHistory.length,1);assert.deepEqual(f.state.ingressRejectedHistory[0].previousAttempt,{sending:true});assert.equal(f.state.ingestCredential.id,'ingest1');assert.ok(snapshots.some(s=>s.ingestCredential?.sending===true&&s.ingestCredential.retryOf&&s.ingressRejectedHistory?.length===1));await installCanary(f);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route==='/credentials').length,1);
});
test('a lost retry receipt stays uncertain and cannot be retried through the old reconciliation authorization',async()=>{
 const f=rejectedFixture(),real=f.api;let posts=0;f.api=async(m,p,b)=>{const r=await real(m,p,b);if(m==='POST'&&p==='/credentials'){posts++;throw Error('LOST_RECEIPT');}return r;};await assert.rejects(installCanary(f));assert.ok(f.state.ingestCredential.retryOf);assert.equal(f.state.ingressRejectedHistory.length,1);await assert.rejects(installCanary(f));assert.equal(posts,1);
 const unsafe=rejectedFixture();delete unsafe.ingressRetryAuthorization.checkpointBackupCreated;await assert.rejects(installCanary(unsafe),/BACKUP_REQUIRED/);assert.equal(unsafe.calls.filter(c=>c.method==='POST').length,0);
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
