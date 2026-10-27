// OWNER computer only. Installs one bounded receiver, not a night schedule.
// Clay is never called. Google tokens remain in n8n. Private files are not Git.
import {readFile,writeFile,mkdir,lstat,realpath,rename,open,unlink} from 'node:fs/promises';import {homedir,hostname} from 'node:os';import path from 'node:path';import {createHash,randomBytes,randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';import {createInterface} from 'node:readline/promises';import {fileURLToPath} from 'node:url';
import {openContaboTransport,diagnoseN8nAccess,remoteJson} from './n8n-contabo-transport.mjs';
import {legacyRejectedMarker,authorizeRejectedIngress,validateRetryAuthorization,freshPermissionEvidence} from './n8n-reconcile-ingress.mjs';
const origin='https://automation.shadow-bridge.eu',name='ShadowBridge Global B2B Sourcing V1',must=(v,c)=>{if(!v)throw Error(c);},hash=v=>createHash('sha256').update(v).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const stableHash=v=>hash(JSON.stringify(sorted(v)));
function reportFailure(e){return{status:'BLOCKED',reason:/^[A-Z0-9_]{4,120}$/.test(e.message||'')?e.message:'CANARY_INTERRUPTED_CHECK_PRIVATE_CHECKPOINT',stage:/^[a-z.]{4,70}$/.test(e.stage||'')?e.stage:'operator',httpStatus:e.httpStatus??null,...(/^[A-Za-z0-9_-]{1,100}$/.test(e.workflowId||'')?{workflowId:e.workflowId,workflowUrl:origin+'/workflow/'+e.workflowId}:{}),checkpointRetained:true,automaticRetry:false,noLiveSourcingClaimed:true};}
async function atStage(stage,fn){try{return await fn();}catch(e){e.stage=stage;throw e;}}
async function privateRead(file){const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&511)===384&&s.uid===process.getuid(),'PRIVATE_OWNER_FILE_REQUIRED');return readFile(file,'utf8');}
async function input(label,hidden=false){must(process.stdin.isTTY,'PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');if(hidden)execFileSync('stty',['-echo'],{stdio:['inherit','ignore','ignore']});const rl=createInterface({input:process.stdin,output:process.stdout,terminal:false});try{let s=(await rl.question(label)).trim();if(s.startsWith('\x1b[200~')&&s.endsWith('\x1b[201~'))s=s.slice(6,-6).trim();must(s.length<=8192&&!/[\x00-\x1f\x7f-\x9f]/.test(s),'TERMINAL_INPUT_INVALID');return s;}finally{rl.close();if(hidden){execFileSync('stty',['echo'],{stdio:['inherit','ignore','ignore']});process.stdout.write('\n');}process.stdin.pause();}}
async function jsonRequest(url,{method='GET',headers={},body}={}){const r=await fetch(url,{method,headers:{Accept:'application/json',...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});if(r.status===204)return{};const chunks=[];let size=0;for await(const b of r.body){size+=b.length;must(size<=(r.ok?8388608:32768),'CANARY_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(b));}let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('CANARY_RESPONSE_JSON_INVALID');}if(!r.ok){const code=/^(?:CANARY_|CRM_|GOOGLE_SHEETS_)[A-Z0-9_]{1,110}$/.test(data?.reason||'')?data.reason:'CANARY_HTTP_'+r.status;const e=Error(code);e.httpStatus=r.status;throw e;}return data;}
export async function installCanary({api,template,googleCredentialId,projectId,profile,state,save,ownerProvidedBinding=false,ingressRetryAuthorization}){
 must(template.name===name&&template.active===false&&!template.nodes.some(n=>/schedule|sendEmail|whatsapp/i.test(n.type)),'CANARY_TEMPLATE_INVALID');must(/^[A-Za-z0-9_-]{1,100}$/.test(googleCredentialId),'GOOGLE_CREDENTIAL_ID_REQUIRED');
 must(/^[A-Za-z0-9_-]{1,100}$/.test(projectId||''),'CANARY_EXISTING_PROJECT_REQUIRED');
 must(!state.projectId||state.projectId===projectId,'CANARY_PROJECT_CHANGED');state.projectId=projectId;await save(state);
 // Official n8n 2.44.6 credentials LIST returns metadata only. Never use a
 // decrypted export, credential test, OAuth callback or editor-session cookie.
 const credentials=[];let credentialCursor,targetedOnly=false;
 if(ownerProvidedBinding){const bindings=template.nodes.flatMap(n=>n.credentials?.googleSheetsOAuth2Api?[n.credentials.googleSheetsOAuth2Api]:[]);must(bindings.length===4&&bindings.every(c=>c.id===googleCredentialId),'OWNER_GOOGLE_BINDING_NOT_PINNED');credentials.push({id:googleCredentialId,name:bindings[0].name,type:'googleSheetsOAuth2Api'});targetedOnly=true;}
 else{
  try{for(let i=0;i<20;i++){const r=await api('GET','/credentials?limit=100'+(credentialCursor?'&cursor='+encodeURIComponent(credentialCursor):''));must(Array.isArray(r.data),'CANARY_CREDENTIAL_METADATA_INVALID');must(r.data.every(c=>!Object.hasOwn(c,'data')),'CANARY_UNEXPECTED_CREDENTIAL_DATA');credentials.push(...r.data);credentialCursor=r.nextCursor;if(!credentialCursor)break;}}
  catch(e){if(e.httpStatus!==403)throw e;targetedOnly=true;credentials.length=0;credentialCursor=null;const c=await api('GET','/credentials/'+googleCredentialId);must(c&&!Object.hasOwn(c,'data'),'CANARY_UNEXPECTED_CREDENTIAL_DATA');credentials.push(c);}
 }
 must(!credentialCursor,'CANARY_CREDENTIAL_LIST_INCOMPLETE');const google=credentials.filter(c=>c.id===googleCredentialId);must(google.length===1&&google[0].type==='googleSheetsOAuth2Api','GOOGLE_CREDENTIAL_METADATA_NOT_CONFIRMED');
 // CredentialListSharedItem uses `id` for the project (unlike workflow shares).
 if(!targetedOnly)must(google[0].shared?.some(s=>s.id===projectId),'GOOGLE_CREDENTIAL_NOT_IN_TARGET_PROJECT');
 // The targeted endpoint enforces credential:read. Creation enforces native
 // project permissions and resolves bindings. Verify EVERY binding in GET below
 // before publishing; never reattach credentials removed by n8n validation.
 const all=[];let cursor;for(let i=0;i<20;i++){const r=await api('GET','/workflows?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));must(Array.isArray(r.data),'CANARY_WORKFLOW_LIST_INVALID');all.push(...r.data);cursor=r.nextCursor;if(!cursor)break;}must(!cursor,'CANARY_WORKFLOW_LIST_INCOMPLETE');const matches=all.filter(w=>w.name===name);must(matches.length<=1,'CANARY_DUPLICATE_WORKFLOW_NAME');must(!matches.length||state.workflowId===matches[0].id,'EXISTING_WORKFLOW_REQUIRES_REVIEW_NO_OVERWRITE');
 const postOnce=async(key,route,payload)=>{
  if(state[key]?.id)return state[key].id;const retry=key==='ingestCredential'&&route==='/credentials'&&state[key]&&ingressRetryAuthorization;
  if(state[key]){if(!retry)throw Error('CANARY_PREVIOUS_POST_UNCERTAIN_NO_RETRY');validateRetryAuthorization(state,ingressRetryAuthorization);}
  if(retry)state.ingressRejectedHistory=[{...ingressRetryAuthorization,previousAttempt:structuredClone(state[key]),recordedAt:new Date().toISOString()}];
  state[key]={sending:true,...(retry?{retryOf:ingressRetryAuthorization.approvalId}:{})};await save(state);
  const r=await api('POST',route,payload);must(typeof r.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(r.id),'CANARY_POST_RECEIPT_REQUIRED');
  state[key]={id:r.id,...(retry?{retryOf:ingressRetryAuthorization.approvalId}:{})};await save(state);return r.id;
 };
 if(!ownerProvidedBinding)await api('GET','/credentials/schema/httpHeaderAuth');
 const credentialId=await postOnce('ingestCredential','/credentials',{name:'ShadowBridge private Clay intake',type:'httpHeaderAuth',projectId,data:{name:'Authorization',value:profile.headerValue}});
 const w=structuredClone(template);for(const n of w.nodes){if(n.credentials?.googleSheetsOAuth2Api)n.credentials.googleSheetsOAuth2Api.id=googleCredentialId;if(n.credentials?.httpHeaderAuth)n.credentials.httpHeaderAuth.id=credentialId;}
 const body={name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings};state.expectedWorkflowHash=stableHash(body);await save(state);
 const workflowId=await postOnce('createdWorkflow','/workflows',{...body,projectId});state.workflowId=workflowId;await save(state);
 const current=await api('GET','/workflows/'+workflowId),view={name:current.name,nodes:current.nodes,connections:current.connections,settings:current.settings};
 // n8n may add harmless settings defaults; compare every requested setting and
 // the complete graph, never replace an edited existing workflow.
 must(current.name===body.name&&stableHash(current.nodes)===stableHash(body.nodes)&&stableHash(current.connections)===stableHash(body.connections)&&Object.entries(body.settings).every(([k,v])=>current.settings?.[k]===v),'CANARY_GRAPH_DRIFT_NO_UPDATE');must(!current.settings?.errorWorkflow,'CANARY_EXTERNAL_ERROR_FORWARDING_BLOCKED');
 must(current.shared?.some(s=>s.projectId===projectId&&s.role==='workflow:owner'),'CANARY_WORKFLOW_PROJECT_NOT_CONFIRMED');
 if(current.active!==true){must(!state.activationPending,'CANARY_ACTIVATION_OUTCOME_UNCERTAIN');state.activationPending=true;await save(state);await api('POST','/workflows/'+workflowId+'/activate');}
 const live=await api('GET','/workflows/'+workflowId);must(live.active===true,'CANARY_RECEIVER_ACTIVATION_NOT_PROVEN');state.activationPending=false;state.receiverActive=true;await save(state);
 return{status:'CANARY_RECEIVER_ACTIVE_NOT_SOURCING_VERIFIED',workflowName:name,workflowId,workflowUrl:origin+'/workflow/'+workflowId,projectId,maximumRowsPerRequest:5,sourceApiCalls:0,sourcingScheduled:false,crmWrites:0,googleCredentialMetadataVerified:!ownerProvidedBinding,googleCredentialName:google[0].name,googleMetadataReadMode:ownerProvidedBinding?'OWNER_PROVIDED_ID_NATIVE_PROJECT_AND_GRAPH_VERIFIED':targetedOnly?'TARGET_ID_WITH_NATIVE_PROJECT_AND_GRAPH_CHECK':'GLOBAL_METADATA_LIST',googleCredentialPermissionVerified:false,clayCredentialCandidates:targetedOnly?null:credentials.filter(c=>/clay/i.test(c.name+' '+c.type)).length,clayAuthorizationVerified:false};
}
export async function inspectCanary({call,batchId}){
 must(/^[A-Za-z0-9_-]{16,80}$/.test(batchId||''),'CANARY_BATCH_ID_REQUIRED');
 const r=await call({mode:'inspect',batchId,rows:[]});
 must(r.status==='CRM_READ_CONFIRMED'&&r.batchId===batchId&&r.crmWrites===0&&r.clayApiCalls===0&&r.dataCreditsUsedByBridge===0&&r.emailWritingSupported===false&&r.sourcingScheduled===false,'CRM_INSPECTION_NOT_CONFIRMED');
 for(const k of ['existingRows','legacyRows','duplicateIds'])must(Number.isSafeInteger(r[k])&&r[k]>=0&&r[k]<=20000,'CRM_INSPECTION_COUNTS_INVALID');
 const fields=['sbKey','company','country','industry','fullName','title','website','personLinkedIn','source','emailStatus'];
 for(const k of ['missingFields','ambiguousFields'])must(Array.isArray(r[k])&&r[k].length<=fields.length&&r[k].every(f=>fields.includes(f)),'CRM_INSPECTION_SCHEMA_INVALID');
 must(typeof r.canarySchemaReady==='boolean'&&typeof r.emailColumnPresent==='boolean'&&r.canarySchemaReady===(r.missingFields.length===0&&r.ambiguousFields.length===0&&r.legacyRows===0&&r.duplicateIds===0),'CRM_INSPECTION_SCHEMA_INVALID');
 return{status:'CRM_READ_CONFIRMED',batchId,existingRows:r.existingRows,missingFields:r.missingFields,ambiguousFields:r.ambiguousFields,legacyRows:r.legacyRows,duplicateIds:r.duplicateIds,canarySchemaReady:r.canarySchemaReady,emailColumnPresent:r.emailColumnPresent,emailWritingSupported:false,crmWrites:0,clayApiCalls:0,dataCreditsUsedByBridge:0,sourcingScheduled:false,liveReadPerformed:true};
}
function safeReceipt(r,payload){must(r.batchId===payload.batchId&&r.sourceRows===payload.rows.length&&r.emailAddressesCollected===0&&r.phoneNumbersCollected===0&&r.clayApiCalls===0&&r.dataCreditsUsedByBridge===0,'CANARY_RECEIPT_SCOPE_INVALID');for(const k of ['rowsAppended','duplicateRows','confirmedUniqueRows'])must(Number.isInteger(r[k])&&r[k]>=0&&r[k]<=5,'CANARY_RECEIPT_COUNTS_INVALID');return{status:r.status,batchId:payload.batchId,sourceRows:r.sourceRows,rowsAppended:r.rowsAppended,duplicateRows:r.duplicateRows,confirmedUniqueRows:r.confirmedUniqueRows,emailAddressesCollected:0,phoneNumbersCollected:0,clayApiCalls:0,dataCreditsUsedByBridge:0,clayDiscoveryActionUsage:'NOT_MEASURED_BY_BRIDGE',sourcingScheduled:false,liveReadPerformed:true};}
export async function sendCanary({call,payload,state,save}){
 must(Array.isArray(payload.rows)&&payload.rows.length>0&&payload.rows.length<=5&&/^[A-Za-z0-9_-]{16,80}$/.test(payload.batchId||''),'CANARY_PAYLOAD_INVALID');
 const fingerprint=stableHash({batchId:payload.batchId,rows:payload.rows});must(!state.inputHash||state.inputHash===fingerprint,'CANARY_INPUT_CHANGED');state.inputHash=fingerprint;
 if(state.phase==='VERIFIED')return{...state.result,receiptReused:true,liveReadPerformed:false};
 if(['SENDING','UNCERTAIN'].includes(state.phase)){const r=await call({...payload,mode:'verify'});must(r.status==='READBACK_CONFIRMED','CANARY_UNCERTAIN_WRITE_NOT_RECONCILED');const receipt=safeReceipt(r,payload);state.phase='VERIFIED';state.result=receipt;await save(state);return receipt;}
 const preview=await call({...payload,mode:'preview'});must(preview.status==='PREVIEW_ONLY'&&preview.batchId===payload.batchId&&preview.sourceRows===payload.rows.length&&preview.crmWrites===0&&Number.isInteger(preview.rowsToAppend)&&preview.rowsToAppend>=0&&preview.rowsToAppend<=5,'CANARY_PREVIEW_NOT_PROVEN');
 state.phase='SENDING';await save(state);
 try{const r=await call({...payload,mode:'append'});must(r.status==='CANARY_CRM_READBACK_CONFIRMED','CANARY_CRM_WRITE_NOT_VERIFIED');const receipt=safeReceipt(r,payload);state.phase='VERIFIED';state.result=receipt;await save(state);return receipt;}catch(e){state.phase='UNCERTAIN';await save(state);throw e;}
}
export async function main(args=process.argv.slice(2)){
 must(hostname()!=='vmi3682957'&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','OWNER_COMPUTER_AND_TLS_REQUIRED');const mode=args[0];must(['--install','--send','--inspect'].includes(mode),'USE_INSTALL_SEND_OR_INSPECT');
 const dir=path.join(homedir(),'.local/state/shadowbridge-sourcing-v1/clay-canary');await mkdir(dir,{recursive:true,mode:0o700});const st=await lstat(dir);must(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&511)===448&&st.uid===process.getuid()&&await realpath(dir)===dir,'PRIVATE_OWNER_DIRECTORY_REQUIRED');
 const lockFile=dir+'/operation.lock',nonce=randomUUID(),lock=await open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,nonce}));await lock.close();
 let transport;
 try{
  const file=mode==='--install'?dir+'/install.json':mode==='--inspect'?dir+'/inspect.json':dir+'/send-'+(args.find(a=>a.startsWith('--batch='))?.slice(8)||'invalid')+'.json';must(mode!=='--send'||/^send-[A-Za-z0-9_-]{16,80}\.json$/.test(path.basename(file)),'CANARY_BATCH_ID_REQUIRED');let last=null,state={};try{last=await privateRead(file);state=JSON.parse(last);}catch(e){if(e.code!=='ENOENT')throw e;}
  const save=async s=>{if(last!==null)must(await privateRead(file)===last,'CANARY_CHECKPOINT_CHANGED');else try{await lstat(file);throw Error('CANARY_CHECKPOINT_CHANGED');}catch(e){if(e.code!=='ENOENT')throw e;}const text=JSON.stringify(s,null,2)+'\n',temp=file+'.'+nonce;await writeFile(temp,text,{mode:0o600,flag:'wx'});await rename(temp,file);last=text;};
  const profileFile=dir+'/connection.json';let profile;try{profile=JSON.parse(await privateRead(profileFile));}catch(e){if(e.code!=='ENOENT'||mode!=='--install')throw e;profile={headerValue:'Bearer '+randomBytes(32).toString('base64url'),webhookUrl:origin+'/webhook/shadowbridge-global-b2b-sourcing-v1-canary'};await writeFile(profileFile,JSON.stringify(profile)+'\n',{mode:0o600,flag:'wx'});}
  must(/^Bearer [A-Za-z0-9_-]{43}$/.test(profile.headerValue)&&profile.webhookUrl===origin+'/webhook/shadowbridge-global-b2b-sourcing-v1-canary','PRIVATE_CANARY_PROFILE_INVALID');
  const sshTarget=args.find(a=>a.startsWith('--ssh='))?.slice(6);
  if(sshTarget)transport=await atStage('operator.ssh',()=>openContaboTransport(sshTarget));
  const webhook=body=>transport?remoteJson(transport.request,'/webhook/shadowbridge-global-b2b-sourcing-v1-canary',{method:'POST',headers:{Authorization:profile.headerValue},body}):jsonRequest(profile.webhookUrl,{method:'POST',headers:{Authorization:profile.headerValue},body});
  let result;
  if(mode==='--install'){
   const source=args.find(a=>a.startsWith('--workflow='))?.slice(11),digest=args.find(a=>a.startsWith('--sha256='))?.slice(9),projectId=args.find(a=>a.startsWith('--project='))?.slice(10);must(source&&/^[a-f0-9]{64}$/.test(digest||''),'PINNED_PRIVATE_WORKFLOW_REQUIRED');must(/^[A-Za-z0-9_-]{1,100}$/.test(projectId||''),'CANARY_EXISTING_PROJECT_REQUIRED');const bytes=await readFile(source);must(bytes.length<=1048576&&hash(bytes)===digest,'PRIVATE_WORKFLOW_HASH_MISMATCH');const template=JSON.parse(bytes),key=await input('Istniejący klucz n8n API (ukryty): ',true),ids=[...new Set(template.nodes.flatMap(n=>n.credentials?.googleSheetsOAuth2Api?[n.credentials.googleSheetsOAuth2Api.id]:[]))];
   must(ids.length===1&&ids[0]!=='OWNER_SELECT_GOOGLE_SHEETS','PINNED_GOOGLE_BINDING_REQUIRED');const googleId=ids[0];
   must(!state.templateSha||state.templateSha===digest,'CANARY_TEMPLATE_CHANGED');must(!state.googleCredentialId||state.googleCredentialId===googleId,'CANARY_GOOGLE_BINDING_CHANGED');state.templateSha=digest;state.googleCredentialId=googleId;await save(state);
   const ownerProvidedBinding=args.includes('--known-google-binding');
   if(transport){
    const diagnostic=await atStage('access.diagnostic',()=>diagnoseN8nAccess({request:transport.request,key,projectId,googleId,ownerProvidedBinding}));
    diagnostic.checkpoint={retained:true,templateShaMatches:state.templateSha===digest,projectMatches:!state.projectId||state.projectId===projectId,googleBindingMatches:state.googleCredentialId===googleId,ingressCreationStarted:!!state.ingestCredential,workflowCreationStarted:!!state.createdWorkflow,receiverPreviouslyActive:state.receiverActive===true};
    const diagnosticFile=dir+'/access-'+nonce+'.json';await writeFile(diagnosticFile,JSON.stringify(diagnostic,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({...diagnostic,privateDiagnostic:diagnosticFile}));
    if(!diagnostic.canResumeImport){const e=Error('N8N_ACCESS_DIAGNOSTIC_BLOCKED');e.stage='access.diagnostic';throw e;}
   }
   let ingressRetryAuthorization;
   if(args.includes('--resume-rejected-ingress403')&&!state.ingestCredential?.id){
    must(transport&&ownerProvidedBinding,'AUTHORIZED_SSH_KNOWN_BINDING_REQUIRED');must(legacyRejectedMarker(state),'ONLY_LEGACY_REJECTED_INGRESS_MAY_BE_RECONCILED');
    const before=await privateRead(file),fresh=await atStage('ingress.reconciliation.readonly',()=>freshPermissionEvidence({transport,key,projectId,googleId,sshTarget}));
    ingressRetryAuthorization=authorizeRejectedIngress({state,evidence:fresh.evidence,requestId:fresh.requestId,ownerApproval:true});
    must(await privateRead(file)===before,'CANARY_CHECKPOINT_CHANGED');
    const backup=dir+'/install.before-rejected-ingress-'+nonce+'.json',evidenceFile=dir+'/ingress-retry-evidence-'+nonce+'.json';
    await writeFile(backup,before,{mode:0o600,flag:'wx'});await writeFile(evidenceFile,JSON.stringify(fresh.evidence),{mode:0o600,flag:'wx'});
    ingressRetryAuthorization={...ingressRetryAuthorization,checkpointBeforeHash:hash(before),checkpointBackupCreated:true,checkpointBackup:backup,evidenceFile};
   }
   result=await installCanary({api:(method,route,body)=>atStage(route.startsWith('/credentials?')?'credential.metadata.read':route.startsWith('/credentials/schema/')?'credential.schema.read':route.startsWith('/credentials/')?'credential.target.read':route==='/credentials'?'ingest.credential.create':route==='/workflows'?'workflow.create':route.endsWith('/activate')?'receiver.activate':'workflow.read',()=>transport?remoteJson(transport.request,'/api/v1'+route,{method,headers:{'X-N8N-API-KEY':key},body}):jsonRequest(origin+'/api/v1'+route,{method,headers:{'X-N8N-API-KEY':key},body})),template,googleCredentialId:googleId,projectId,profile,state,save,ownerProvidedBinding,ingressRetryAuthorization});
   const inspection=await atStage('crm.read.only',()=>inspectCanary({call:webhook,batchId:randomUUID()}));state.latestInspection=inspection;await save(state);result={...result,crmInspection:inspection,googleCredentialPermissionVerified:true,operatorTransport:transport?'SSH_AUTHENTICATED_CONTABO_LOOPBACK':'PUBLIC_HTTPS'};
  }else if(mode==='--inspect'){
   result=await inspectCanary({call:webhook,batchId:randomUUID()});state.latestInspection=result;await save(state);
  }else{
   const source=args.find(a=>a.startsWith('--payload='))?.slice(10);must(source,'PRIVATE_CANARY_PAYLOAD_REQUIRED');const payload=JSON.parse(await privateRead(source));must(path.basename(file)==='send-'+payload.batchId+'.json','CANARY_BATCH_MISMATCH');result=await sendCanary({call:webhook,payload,state,save});
  }
  console.log(JSON.stringify({...result,privateCheckpoint:file}));
 }catch(e){try{const checkpoint=JSON.parse(await privateRead(dir+'/install.json'));if(checkpoint.workflowId)e.workflowId=checkpoint.workflowId;}catch{}throw e;
 }finally{await transport?.close();const current=JSON.parse(await readFile(lockFile,'utf8'));must(current.nonce===nonce&&current.pid===process.pid,'CANARY_LOCK_CHANGED_PRESERVE');await unlink(lockFile);}
}
export {reportFailure};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify(reportFailure(e)));process.exitCode=1;});
