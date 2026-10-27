import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {readFile,lstat,chmod} from 'node:fs/promises';
import {authorizeRejectedIngress,validateRetryAuthorization,legacyRejectedMarker,freshPermissionEvidence,remoteMetadataSetup} from './n8n-reconcile-ingress.mjs';
import {readPrivateMetadataRequest} from './n8n-permission-metadata.mjs';import {extractPermissionMetadata} from './n8n-contabo-transport.mjs';
export function retryFixture(){
 const state={templateSha:'a'.repeat(64),projectId:'project1',googleCredentialId:'google1',ingestCredential:{sending:true}},requestId=randomUUID();
 const evidence={kind:'shadowbridge-n8n-credential-create-permission-metadata',status:'METADATA_READ_ONLY_CONFIRMED',readOnly:true,changesMade:false,apiWrites:0,providerCalls:0,crmWrites:0,operatorRequestId:requestId,observedAt:new Date().toISOString(),exactExistingKeyIdentified:true,keyOwnerDisabled:false,configuredScopeChecks:{'credential:list':false,'credential:read':false,'credential:create':true,'workflow:list':true,'workflow:read':true,'workflow:create':true,'workflow:activate':true},targetProjectId:'project1',selectedGoogleCredential:{id:'google1',type:'googleSheetsOAuth2Api'},googleCredentialSharedWithTarget:true,keyOwnerTargetProjectMembershipExists:true,keyOwnerTargetProjectRole:'project:personalOwner',matchingIngressCredentials:0,matchingWorkflowCount:0};
 return{state,evidence,requestId,ownerApproval:true};
}
test('only an explicit retry of the original marker with fresh exact-key evidence and zero prior artifacts is authorized',()=>{
 const f=retryFixture(),before=JSON.stringify(f.state),a=authorizeRejectedIngress(f);assert.equal(a.kind,'OWNER_APPROVED_RETRY_OF_NATIVE_403');assert.equal(JSON.stringify(f.state),before);
 assert.throws(()=>validateRetryAuthorization(f.state,a),/BACKUP_REQUIRED/);validateRetryAuthorization(f.state,{...a,checkpointBackupCreated:true,checkpointBeforeHash:'b'.repeat(64)});
 assert.throws(()=>authorizeRejectedIngress({...f,ownerApproval:false}),/OWNER_/);
});
test('stale/cross-project evidence, missing scope, disabled account, existing resources and a second pending attempt all stop',()=>{
 const changes=[f=>f.evidence.observedAt='2000-01-01T00:00:00Z',f=>f.evidence.operatorRequestId=randomUUID(),f=>f.evidence.configuredScopeChecks['credential:create']=false,f=>f.evidence.keyOwnerDisabled=true,f=>f.evidence.targetProjectId='other',f=>f.evidence.matchingIngressCredentials=1,f=>f.evidence.matchingWorkflowCount=1,f=>f.evidence.matchingWorkflowCount=null,f=>f.evidence.googleCredentialSharedWithTarget=false,f=>f.evidence.keyOwnerTargetProjectMembershipExists=false,f=>f.state.ingestCredential.retryOf=randomUUID(),f=>f.state.createdWorkflow={sending:true},f=>f.state.ingressRejectedHistory=[{}]];
 for(const change of changes){const f=retryFixture();change(f);assert.throws(()=>authorizeRejectedIngress(f));}
});
test('a backup-bound authorization cannot be applied after the pending marker or binding changes',()=>{
 const f=retryFixture(),a={...authorizeRejectedIngress(f),checkpointBackupCreated:true,checkpointBeforeHash:'b'.repeat(64)};
 assert.throws(()=>validateRetryAuthorization({...f.state,projectId:'other'},a),/STATE_CHANGED/);assert.throws(()=>validateRetryAuthorization(f.state,a,Date.now()+180000),/EXPIRED/);assert.equal(legacyRejectedMarker({...f.state,ingestCredential:{sending:true,retryOf:a.approvalId}}),false);
});
test('fresh administrative evidence uses only a fingerprint in private remote files and correlates the specific request',async()=>{
 const key='FICTIONAL_PRIVATE_TOKEN',f=retryFixture();let prepared,request,command;
 const transport={operatorJson:async(source,input)=>{assert.ok(!source.includes(key));assert.ok(!JSON.stringify(input).includes(key));request=input.request;const r=spawnSync('node',['--input-type=module','-e',source],{input:JSON.stringify(input),encoding:'utf8'});assert.equal(r.status,0,r.stderr);prepared=JSON.parse(r.stdout);return prepared;},operatorInteractiveMetadata:async cmd=>{command=cmd;assert.ok(!cmd.includes(key));assert.ok(!cmd.includes(request.keyHash));return{...f.evidence,operatorRequestId:request.requestId};}};
 const r=await freshPermissionEvidence({transport,key,projectId:'project1',googleId:'google1',sshTarget:'operator@fictional.example.invalid'});assert.equal(r.requestId,request.requestId);assert.equal(r.evidence.operatorRequestId,request.requestId);assert.ok(command.startsWith('sudo node '));
 const file=prepared.directory+'/request.json',loaded=await readPrivateMetadataRequest(file,process.getuid());assert.equal(loaded.keyHash,createHash('sha256').update(key).digest('hex'));assert.ok(!(await readFile(file,'utf8')).includes(key));assert.equal((await lstat(file)).mode&511,384);assert.equal((await lstat(prepared.directory)).mode&511,448);
 await chmod(file,0o644);await assert.rejects(readPrivateMetadataRequest(file,process.getuid()),/PRIVATE_METADATA_REQUEST/);
});
test('metadata setup rejects changed helper code and sudo prefixes do not hide the structured result',async()=>{
 await assert.rejects(remoteMetadataSetup({code:'changed',codeHash:'a'.repeat(64),request:{}}),/INVALID_METADATA_PACKAGE/);
 const result={kind:'shadowbridge-n8n-credential-create-permission-metadata',status:'METADATA_READ_ONLY_CONFIRMED'};
 assert.deepEqual(extractPermissionMetadata('[sudo] password: '+JSON.stringify(result)+'\r\n'),result);assert.throws(()=>extractPermissionMetadata('No structured result'),/RESULT_MISSING/);
});
