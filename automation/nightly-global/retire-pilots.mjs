// Authorized retirement of exactly two named pilots. Private backups are kept
// on the operator's computer. No credential/Data Table deletion or source calls.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,realpath,readFile,writeFile,rename,open,unlink,statfs} from 'node:fs/promises';
import {homedir,hostname} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createInterface} from 'node:readline/promises';import {execFileSync} from 'node:child_process';
export const retiredPilotNames=['ShadowBridge — European B2B Scout V1 (pilot only)','ShadowBridge | Global Hotel Scout | PILOT'];
export const replacementName='ShadowBridge Global B2B Sourcing V1';
const must=(v,c)=>{if(!v)throw Error(c);};
const id=v=>{must(/^[A-Za-z0-9_-]{1,100}$/.test(String(v||'')),'N8N_RESOURCE_ID_INVALID');return String(v);};
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const fingerprint=v=>createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');
export async function listAll(api,route){const values=[],seen=new Set();let cursor=null;
 for(let i=0;i<100;i++){const r=await api('GET',route+(route.includes('?')?'&':'?')+'limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));must(Array.isArray(r.data),'N8N_LIST_RESPONSE_INVALID');values.push(...r.data);if(!r.nextCursor)return values;must(typeof r.nextCursor==='string'&&!seen.has(r.nextCursor)&&r.nextCursor.length<=4096,'N8N_LIST_CURSOR_INVALID');cursor=r.nextCursor;seen.add(cursor);}throw Error('N8N_LIST_INCOMPLETE_NO_DELETE');
}
export function incomingDependencies(workflows,targetIds){const found=[];for(const w of workflows){if(targetIds.includes(String(w.id)))continue;must(Array.isArray(w.nodes),'N8N_WORKFLOW_NODES_NOT_VERIFIED');for(const n of w.nodes){if(n.type!=='n8n-nodes-base.executeWorkflow')continue;const p=n.parameters||{},value=typeof p.workflowId==='object'?p.workflowId?.value:p.workflowId;if(typeof value!=='string'||!value||value.includes('{{'))found.push({workflow:String(w.id),kind:'dynamic_or_unknown'});else if(targetIds.includes(value))found.push({workflow:String(w.id),kind:'direct'});}}return found;}
export function assertNoLiveExecutions(executions,targetIds){for(const e of executions)if(targetIds.includes(String(e.workflowId)))must(['success','error','canceled','crashed'].includes(e.status),'PILOT_HAS_LIVE_OR_UNCERTAIN_EXECUTION');}
function hasBinary(v){if(!v||typeof v!=='object')return false;for(const[k,x]of Object.entries(v)){if(k==='binary'&&x&&typeof x==='object'&&Object.keys(x).length)return true;if(hasBinary(x))return true;}return false;}
function shape(w){const {active,activeVersionId,versionId,versionCounter,updatedAt,...rest}=w;return fingerprint(rest);}

export async function retirePilots({api,store,state,save}){
 must(state.kind==='shadowbridge-pilot-retirement-v1','RETIREMENT_STATE_IDENTITY_INVALID');state.targets||={};
 const summaries=await listAll(api,'/workflows'),workflows=[];
 for(const s of summaries)workflows.push(await api('GET','/workflows/'+id(s.id)));
 const candidates=[];
 for(const name of retiredPilotNames){const found=workflows.filter(w=>w.name===name);must(found.length<=1,'DUPLICATE_PILOT_NAME_REQUIRES_REVIEW');
  if(found.length){const w=found[0],key=id(w.id);must(!state.targets[key]?.deleted,'RECREATED_PILOT_REQUIRES_REVIEW');candidates.push(w);}
  else{const prior=Object.entries(state.targets).filter(([,v])=>v.name===name);must(prior.length===1,'EXPECTED_PILOT_NOT_FOUND_NO_DELETE');const[key,t]=prior[0];
   await store.verify('workflow-'+id(key)+'.json',t.originalHash);
   if(t.deleted!==true){must(t.deletePending===true,'EXPECTED_PILOT_NOT_FOUND_NO_DELETE');let missing=false;try{await api('GET','/workflows/'+id(key));}catch(e){if(e.httpStatus===404)missing=true;else throw e;}must(missing,'DELETE_OUTCOME_UNCERTAIN_NO_RETRY');t.deleted=true;t.deletePending=false;await save(state);}
  }
 }
 const targetIds=[...new Set([...candidates.map(w=>id(w.id)),...Object.keys(state.targets)])];
 // Preserve every target and execution before deactivating or deleting anything.
 for(const w of candidates){const key=id(w.id),prior=state.targets[key];
  if(prior?.deletePending)throw Error('DELETE_OUTCOME_UNCERTAIN_NO_RETRY');
  if(prior){const original=await store.verify('workflow-'+key+'.json',prior.originalHash);must(prior.name===w.name,'PILOT_CHANGED_SINCE_CHECKPOINT_NO_DELETE');
   if(prior.deactivatePending&&w.active===false){must(shape(w)===shape(original),'PILOT_DEACTIVATION_UNCERTAIN_CHANGE');await store('deactivated-workflow-'+key+'.json',w);prior.currentHash=fingerprint(w);prior.deactivatePending=false;await save(state);}
   must((prior.currentHash||prior.originalHash)===fingerprint(w),'PILOT_CHANGED_SINCE_CHECKPOINT_NO_DELETE');
  }else{const backup=await store('workflow-'+key+'.json',w);must(backup.sha256===fingerprint(w),'PILOT_BACKUP_VERIFICATION_FAILED');state.targets[key]={name:w.name,originalHash:fingerprint(w),wasActive:w.active===true,originalBackup:backup.file};await save(state);}
 }
 must(incomingDependencies(workflows,targetIds).length===0,'PILOT_REFERENCED_OR_DYNAMIC_DEPENDENCY_NO_DELETE');
 const executions=await listAll(api,'/executions?includeData=false');assertNoLiveExecutions(executions,targetIds);
 for(const e of executions.filter(e=>targetIds.includes(String(e.workflowId)))){const record=await api('GET','/executions/'+id(e.id)+'?includeData=true');must(!hasBinary(record),'EXECUTION_BINARY_BACKUP_REQUIRED_NO_DELETE');await store('execution-'+id(e.id)+'.json',record);}
 for(const w of candidates){const key=id(w.id),t=state.targets[key];let current=await api('GET','/workflows/'+key);
  must(fingerprint(current)===(t.currentHash||t.originalHash),'PILOT_CHANGED_BEFORE_DEACTIVATION');
  if(current.active===true){must(!t.deactivatePending,'DEACTIVATION_OUTCOME_UNCERTAIN_NO_RETRY');t.deactivatePending=true;await save(state);await api('POST','/workflows/'+key+'/deactivate');current=await api('GET','/workflows/'+key);must(current.active===false&&shape(current)===shape(w),'PILOT_DEACTIVATION_UNEXPECTED_CHANGE');await store('deactivated-workflow-'+key+'.json',current);t.currentHash=fingerprint(current);t.deactivatePending=false;await save(state);}
  else if(t.deactivatePending){must(shape(current)===shape(w),'PILOT_DEACTIVATION_UNCERTAIN_CHANGE');await store('deactivated-workflow-'+key+'.json',current);t.currentHash=fingerprint(current);t.deactivatePending=false;await save(state);}
 }
 // Recheck graph and live work after schedules have been stopped.
 const fresh=[];for(const w of await listAll(api,'/workflows'))fresh.push(await api('GET','/workflows/'+id(w.id)));
 must(incomingDependencies(fresh,targetIds).length===0,'PILOT_DEPENDENCY_CHANGED_NO_DELETE');
 const latest=await listAll(api,'/executions?includeData=false');assertNoLiveExecutions(latest,targetIds);
 for(const e of latest.filter(e=>targetIds.includes(String(e.workflowId)))){const record=await api('GET','/executions/'+id(e.id)+'?includeData=true');must(!hasBinary(record),'EXECUTION_BINARY_BACKUP_REQUIRED_NO_DELETE');await store('execution-'+id(e.id)+'.json',record);}
 for(const w of candidates){const key=id(w.id),t=state.targets[key],current=await api('GET','/workflows/'+key);
  must(current.active===false&&fingerprint(current)===(t.currentHash||t.originalHash),'PILOT_CHANGED_BEFORE_DELETE');
  assertNoLiveExecutions(await listAll(api,'/executions?includeData=false'),targetIds);
  t.deletePending=true;await save(state);await api('DELETE','/workflows/'+key);
  let gone=false;try{await api('GET','/workflows/'+key);}catch(e){if(e.httpStatus===404)gone=true;else throw e;}must(gone,'PILOT_DELETE_NOT_CONFIRMED');t.deleted=true;t.deletePending=false;await save(state);
 }
 return{status:'PILOTS_RETIRED',archivedAndDeleted:Object.values(state.targets).filter(t=>t.deleted).length,credentialsDeleted:0,dataTablesDeleted:0,replacement:{name:replacementName,created:false,active:false,reason:'SOURCE_AND_EXISTING_GOOGLE_SHEETS_AUTHORIZATION_REQUIRED'},providerCalls:0,crmWrites:0,scheduled:false};
}

async function hiddenKey(){must(process.stdin.isTTY,'PRIVATE_INTERACTIVE_TERMINAL_REQUIRED');execFileSync('stty',['-echo'],{stdio:['inherit','ignore','ignore']});const rl=createInterface({input:process.stdin,output:process.stdout,terminal:false});try{let s=(await rl.question('Istniejący klucz API n8n (ukryty; bez kluczy Apollo/Clay): ')).trim();if(s.startsWith('\x1b[200~')&&s.endsWith('\x1b[201~'))s=s.slice(6,-6).trim();must(s.length>0&&s.length<=8192&&!/[\x00-\x1f\x7f-\x9f]/.test(s),'N8N_HIDDEN_KEY_INVALID');return s;}finally{rl.close();execFileSync('stty',['echo'],{stdio:['inherit','ignore','ignore']});process.stdout.write('\n');process.stdin.pause();}}
export async function main(){
 must(process.argv.slice(2).join(' ')==='--apply'&&hostname()!=='vmi3682957','RUN_AUTHORIZED_RETIREMENT_ON_OWNER_COMPUTER');must(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','TLS_VERIFICATION_REQUIRED');
 const dir=path.join(homedir(),'.local/state/shadowbridge-sourcing-v1/pilot-retirement');await mkdir(dir,{recursive:true,mode:0o700});const info=await lstat(dir);must(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&511)===448&&info.uid===process.getuid()&&await realpath(dir)===dir,'PRIVATE_LOCAL_ARCHIVE_DIRECTORY_REQUIRED');
 const stateFile=dir+'/state.json',lockFile=dir+'/operation.lock',nonce=randomUUID(),lock=await open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,nonce}));await lock.close();
 try{
  const readPrivate=async file=>{const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&511)===384&&s.uid===process.getuid(),'PRIVATE_ARCHIVE_FILE_REQUIRED');return readFile(file,'utf8');};
  let state={kind:'shadowbridge-pilot-retirement-v1',targets:{}},last=null;try{last=await readPrivate(stateFile);state=JSON.parse(last);}catch(e){if(e.code!=='ENOENT')throw e;}
  const save=async s=>{if(last!==null)must(await readPrivate(stateFile)===last,'RETIREMENT_CHECKPOINT_CHANGED');else try{await lstat(stateFile);throw Error('RETIREMENT_CHECKPOINT_CHANGED');}catch(e){if(e.code!=='ENOENT')throw e;}const text=JSON.stringify(s,null,2)+'\n',tmp=stateFile+'.'+nonce;await writeFile(tmp,text,{mode:0o600,flag:'wx'});await rename(tmp,stateFile);last=text;};
  const store=async(name,v)=>{must(/^(?:workflow|deactivated-workflow|execution)-[A-Za-z0-9_-]{1,100}\.json$/.test(name),'ARCHIVE_NAME_INVALID');const file=dir+'/'+name,text=JSON.stringify(v,null,2)+'\n',disk=await statfs(dir);must(disk.bavail*disk.bsize>Buffer.byteLength(text)*2+134217728,'INSUFFICIENT_LOCAL_BACKUP_SPACE');try{await writeFile(file,text,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}must(fingerprint(JSON.parse(await readPrivate(file)))===fingerprint(v),'ARCHIVE_EXISTS_WITH_DIFFERENT_BYTES');return{file,sha256:fingerprint(v)};};
  store.verify=async(name,expected)=>{must(/^workflow-[A-Za-z0-9_-]{1,100}\.json$/.test(name),'ARCHIVE_NAME_INVALID');const v=JSON.parse(await readPrivate(dir+'/'+name));must(fingerprint(v)===expected,'PILOT_BACKUP_VERIFICATION_FAILED');return v;};
  const key=await hiddenKey();const api=async(method,route,body)=>{must(/^\/(?:workflows|executions)(?:[/?]|$)/.test(route),'RETIREMENT_API_ROUTE_REFUSED');const r=await fetch('https://automation.shadow-bridge.eu/api/v1'+route,{method,headers:{'X-N8N-API-KEY':key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok){await r.body?.cancel();const e=Error('N8N_API_HTTP_'+r.status);e.httpStatus=r.status;throw e;}if(r.status===204)return{};let bytes=0;const chunks=[];for await(const c of r.body){bytes+=c.length;must(bytes<=16777216,'N8N_BACKUP_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(c));}const text=Buffer.concat(chunks).toString();return text?JSON.parse(text):{};};
  console.log(JSON.stringify({...await retirePilots({api,store,state,save}),localBackupDirectory:dir}));
 }finally{const current=JSON.parse(await readFile(lockFile,'utf8'));must(current.nonce===nonce&&current.pid===process.pid,'RETIREMENT_LOCK_CHANGED_PRESERVE');await unlink(lockFile);}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]{4,120}$/.test(e.message||'')?e.message:'RETIREMENT_INTERRUPTED_CHECK_LOCAL_CHECKPOINT',httpStatus:e.httpStatus??null,checkpointRetained:true,automaticRetry:false,noSuccessClaimed:true}));process.exitCode=1;});
