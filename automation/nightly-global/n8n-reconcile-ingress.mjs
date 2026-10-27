// Reconcile ONLY the legacy pending marker from the diagnosed native403.
// Fresh root READ ONLY evidence + explicit OWNER retry + exact backup are
// required. No DB writes, permission changes or generic checkpoint reset.
import {readFile} from 'node:fs/promises';import {createHash,randomUUID} from 'node:crypto';
import {readRpcInput} from './n8n-contabo-transport.mjs';
const must=(v,c)=>{if(!v)throw Error(c);},sha=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const markerHash=state=>sha(stable(state.ingestCredential));
export const bindingHash=state=>sha(stable({templateSha:state.templateSha,projectId:state.projectId,googleCredentialId:state.googleCredentialId}));
export function legacyRejectedMarker(state){return state.ingestCredential?.sending===true&&Object.keys(state.ingestCredential).length===1&&!state.ingressRejectedHistory?.length&&!state.createdWorkflow&&!state.workflowId&&!state.receiverActive&&!state.expectedWorkflowHash;}
export function authorizeRejectedIngress({state,evidence,requestId,ownerApproval,now=Date.now()}){
 must(ownerApproval===true,'OWNER_REJECTED_403_RETRY_APPROVAL_REQUIRED');must(legacyRejectedMarker(state),'ONLY_LEGACY_REJECTED_INGRESS_MAY_BE_RECONCILED');
 must(evidence?.kind==='shadowbridge-n8n-credential-create-permission-metadata'&&evidence.status==='METADATA_READ_ONLY_CONFIRMED'&&evidence.readOnly===true&&evidence.changesMade===false&&evidence.apiWrites===0&&evidence.providerCalls===0&&evidence.crmWrites===0,'FRESH_READ_ONLY_EVIDENCE_REQUIRED');
 must(evidence.operatorRequestId===requestId&&/^[a-f0-9-]{36}$/.test(requestId||''),'METADATA_REQUEST_CORRELATION_REQUIRED');
 const age=now-Date.parse(evidence.observedAt);must(Number.isFinite(age)&&age>=-30000&&age<=120000,'FRESH_METADATA_REQUIRED');
 must(evidence.exactExistingKeyIdentified===true&&evidence.keyOwnerDisabled===false,'EXACT_ENABLED_KEY_REQUIRED');
 for(const s of ['credential:create','workflow:list','workflow:read','workflow:create','workflow:activate'])must(evidence.configuredScopeChecks?.[s]===true,'REQUIRED_SCOPE_NOT_CONFIRMED');
 must(evidence.targetProjectId===state.projectId&&evidence.selectedGoogleCredential?.id===state.googleCredentialId&&evidence.selectedGoogleCredential?.type==='googleSheetsOAuth2Api'&&evidence.googleCredentialSharedWithTarget===true,'RECONCILIATION_BINDING_MISMATCH');
 must(evidence.keyOwnerTargetProjectMembershipExists===true&&['project:personalOwner','project:admin'].includes(evidence.keyOwnerTargetProjectRole),'TARGET_PROJECT_AUTHORIZATION_NOT_CONFIRMED');
 must(evidence.matchingIngressCredentials===0&&evidence.matchingWorkflowCount===0,'PRIOR_ATTEMPT_ARTIFACTS_REQUIRE_REVIEW');
 return{approvalId:requestId,kind:'OWNER_APPROVED_RETRY_OF_NATIVE_403',observedAt:evidence.observedAt,pendingMarkerHash:markerHash(state),bindingHash:bindingHash(state),evidenceHash:sha(JSON.stringify(evidence)),native403Acknowledged:true};
}
export function validateRetryAuthorization(state,authorization,now=Date.now()){
 must(legacyRejectedMarker(state)&&authorization?.kind==='OWNER_APPROVED_RETRY_OF_NATIVE_403'&&authorization.native403Acknowledged===true,'REJECTED_403_AUTHORIZATION_REQUIRED');
 must(authorization.pendingMarkerHash===markerHash(state)&&authorization.bindingHash===bindingHash(state),'RECONCILIATION_STATE_CHANGED');
 const age=now-Date.parse(authorization.observedAt);must(Number.isFinite(age)&&age>=-30000&&age<=120000,'RECONCILIATION_AUTHORIZATION_EXPIRED');
 must(/^[a-f0-9]{64}$/.test(authorization.checkpointBeforeHash||'')&&/^[a-f0-9]{64}$/.test(authorization.evidenceHash||'')&&authorization.checkpointBackupCreated===true,'CHECKPOINT_BACKUP_REQUIRED');
}
export async function remoteMetadataSetup({code,codeHash,request}){
 const fs=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{hostname}=await import('node:os');
 if(typeof code!=='string'||Buffer.byteLength(code)>131072||createHash('sha256').update(code).digest('hex')!==codeHash||!/^[a-f0-9]{64}$/.test(request?.keyHash||'')||!/^[a-f0-9-]{36}$/.test(request?.requestId||''))throw Error('INVALID_METADATA_PACKAGE');
 const directory=await fs.mkdtemp('/tmp/shadowbridge-n8n-reconcile.');
 await fs.writeFile(directory+'/check.mjs',code,{mode:0o600,flag:'wx'});await fs.writeFile(directory+'/request.json',JSON.stringify(request)+'\n',{mode:0o600,flag:'wx'});
 return{directory,hostname:hostname(),requestId:request.requestId};
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function freshPermissionEvidence({transport,key,projectId,googleId,sshTarget}){
 const operator=sshTarget.split('@')[0];must(/^[a-z][a-z0-9_-]{0,31}$/.test(operator),'AUTHORIZED_OPERATOR_REQUIRED');
 const code=await readFile(new URL('./n8n-permission-metadata.mjs',import.meta.url),'utf8'),requestId=randomUUID();
 const source='try{const input=await ('+readRpcInput.toString()+')(process.stdin);console.log(JSON.stringify(await ('+remoteMetadataSetup.toString()+')(input)));}catch{process.stdout.write(JSON.stringify({status:"BLOCKED"}));process.exitCode=1;}';
 const prepared=await transport.operatorJson(source,{code,codeHash:sha(code),request:{keyHash:sha(key),projectId,googleId,requestId}});
 must(/^\/tmp\/shadowbridge-n8n-reconcile\.[A-Za-z0-9]+$/.test(prepared.directory||'')&&/^[A-Za-z0-9.-]{1,253}$/.test(prepared.hostname||'')&&prepared.requestId===requestId,'PRIVATE_REMOTE_METADATA_SETUP_NOT_CONFIRMED');
 const command=['sudo','node',quote(prepared.directory+'/check.mjs'),'--read-only',quote('--request-file='+prepared.directory+'/request.json'),quote('--host='+prepared.hostname),quote('--operator='+operator),quote('--project='+projectId),quote('--google='+googleId)].join(' ');
 const evidence=await transport.operatorInteractiveMetadata(command);
 must(evidence.operatorRequestId===requestId,'METADATA_REQUEST_CORRELATION_REQUIRED');return{evidence,requestId};
}
