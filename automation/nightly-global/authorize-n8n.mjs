// Run once by the authorized operator on the EXISTING server/account. No
// provider calls, purchases, workflow activation or secrets written to disk.
import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function crmGuardWorkflow(provider){
 if(!['apollo','clay'].includes(provider))throw Error('Unsupported source');
 const credential={httpHeaderAuth:{id:'OWNER_SELECT_CRM_'+provider.toUpperCase(),name:'Restricted CRM gateway '+provider+' - not OWNER'}};
 const http=(name,route,data,x)=>({id:route,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[x,0],parameters:{method:'POST',url:'https://shadow-bridge.eu/api/integrations/acquisition/v1/'+route,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:data,options:{timeout:15000,redirect:{redirect:{followRedirects:false}}}},credentials:credential,retryOnFail:false});
 return {name:'ShadowBridge shared CRM guard '+provider.toUpperCase(),active:false,nodes:[
  {id:'input',name:'Input from acquisition',type:'n8n-nodes-base.executeWorkflowTrigger',typeVersion:1,position:[0,0],parameters:{}},
  {id:'gate',name:'OWNER approval gate',type:'n8n-nodes-base.set',typeVersion:3.4,position:[240,0],parameters:{includeOtherFields:true,assignments:{assignments:[{id:'enabled',name:'enabled',type:'boolean',value:false}]},options:{}}},
  {id:'approved',name:'Approved for CRM access',type:'n8n-nodes-base.if',typeVersion:2.2,position:[480,0],parameters:{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:'enabled',leftValue:'={{ $json.enabled === true }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}},
  {id:'disabled',name:'CRM authorization pending',type:'n8n-nodes-base.stopAndError',typeVersion:1,position:[720,200],parameters:{errorMessage:'CRM gateway not activated. Do not perform paid operations.'}},
  http('Save free facts before any purchase','intake','={{ {record:$("Input from acquisition").item.json.record,companySourceId:$("Input from acquisition").item.json.companySourceId,requestKey:$("Input from acquisition").item.json.requestKey} }}',720),
  http('Check central CRM, no paid action','check','={{ {record:$("Input from acquisition").item.json.record,companySourceId:$("Input from acquisition").item.json.companySourceId,requiredFields:$("Input from acquisition").item.json.requiredFields} }}',960)
 ],connections:{'Input from acquisition':{main:[[{node:'OWNER approval gate',type:'main',index:0}]]},'OWNER approval gate':{main:[[{node:'Approved for CRM access',type:'main',index:0}]]},'Approved for CRM access':{main:[[{node:'Save free facts before any purchase',type:'main',index:0}],[{node:'CRM authorization pending',type:'main',index:0}]]},'Save free facts before any purchase':{main:[[{node:'Check central CRM, no paid action',type:'main',index:0}]]}},settings:{timezone:'Europe/Oslo',executionOrder:'v1',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false,executionTimeout:120},pinData:{},tags:[]};
}
export async function provisionInactive({api,providers,workflows,state,save}){
 const existing=await api('GET','/workflows?limit=100');
 if(existing.nextCursor)throw Error('Workflow listing incomplete; stop before any writes');
 if(!Array.isArray(existing.data))throw Error('Cannot verify existing workflows');
 for(const w of workflows)if(existing.data.some(x=>x.name===w.name&&x.active))throw Error('An existing target workflow is active; no changes made');
 await api('GET','/credentials/schema/httpHeaderAuth');
 state.credentials||={};state.workflows||={};
 const postOnce=async(group,key,endpoint,payload)=>{
  const old=state[group][key];if(old?.status==='done')return old.id;
  if(old)throw Error('Previous POST outcome uncertain; no automatic repeat');
  state[group][key]={status:'sending'};await save(state);
  let r;try{r=await api('POST',endpoint,payload);}catch{state[group][key].status='uncertain';await save(state);throw Error('POST outcome uncertain; checkpoint saved, no retry');}
  if(!r?.id){state[group][key].status='uncertain';await save(state);throw Error('Missing creation receipt; no retry');}
  state[group][key]={status:'done',id:r.id};await save(state);return r.id;
 };
 for(const [provider,value]of Object.entries(providers)){
  if(!value||!['apollo','clay'].includes(provider))continue;
  const name=provider==='apollo'?'X-Api-Key':'Authorization';
  await postOnce('credentials',provider,'/credentials',{name:'ShadowBridge acquisition '+provider+' - authorized account',type:'httpHeaderAuth',data:{name,value:provider==='apollo'?value:'Bearer '+value}});
 }
 for(const source of workflows){
  const w=structuredClone(source);if(w.active!==false)throw Error('Only inactive workflow artifacts allowed');
  if(existing.data.some(x=>x.name===w.name)){state.workflows[w.name]||={status:'existing_unchanged'};await save(state);continue;}
  for(const n of w.nodes)for(const p of ['apollo','clay'])if(n.credentials?.httpHeaderAuth?.id==='OWNER_SELECT_EXISTING_'+p.toUpperCase()&&state.credentials[p]?.id)n.credentials.httpHeaderAuth={id:state.credentials[p].id,name:'ShadowBridge acquisition '+p+' - authorized account'};
  // Public API creates workflows inactive. Never call /activate or update any
  // existing workflow. The response must confirm that it remains inactive.
  const id=await postOnce('workflows',w.name,'/workflows',{name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings});
  const checked=await api('GET','/workflows/'+encodeURIComponent(id));if(checked.active!==false)throw Error('Inactive state not confirmed; stop for review');
 }
 return {status:'IMPORTED_INACTIVE_NOT_CONNECTED_TO_PROVIDERS',providerEntitlementsVerified:false,providerCreditsSpent:0,activeWorkflowsChanged:0,credentialCount:Object.keys(state.credentials).length,workflowStates:Object.values(state.workflows).map(x=>x.status),crmGuardActivated:false};
}
async function hidden(label){
 if(!process.stdin.isTTY)throw Error('Use a private interactive terminal; no keys in command arguments');
 process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();let value='';
 try{return await new Promise((resolve,reject)=>{const read=buf=>{for(const c of buf.toString()){if(c==='\u0003'){process.stdin.off('data',read);reject(Error('Cancelled'));return;}if(c==='\r'||c==='\n'){process.stdin.off('data',read);resolve(value);return;}if(c==='\u007f')value=value.slice(0,-1);else if(c>=' '&&value.length<8192)value+=c;}};process.stdin.on('data',read);});}finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}
export async function main(){
 if(process.argv.includes('--write-workflows')){for(const p of ['apollo','clay'])await writeFile(new URL('./crm-guard-'+p+'.json',import.meta.url),JSON.stringify(crmGuardWorkflow(p),null,2)+'\n');return;}
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({status:'DRY_RUN_NO_NETWORK',existingInstance:'https://automation.shadow-bridge.eu',steps:['verify workflow read and credential schema','store authorized account keys in existing encrypted n8n credentials','import four regional/report workflows and two shared CRM guards inactive'],paidCalls:0,activate:false,crmAccess:false},null,2));return;}
 const dir=path.join(homedir(),'.local','state','shadowbridge-acquisition');await mkdir(dir,{recursive:true,mode:0o700});
 const stateFile=path.join(dir,'authorization.json'),lock=await open(stateFile+'.lock','wx',0o600);
 try{
  let state={};try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const key=await hidden('Istniejacy n8n API key (ukryty, wymagany; tylko import nieaktywny i credentials): ');if(!key)throw Error('n8n authorization required');
  const providers={apollo:await hidden('Apollo klucz tylko odczyt/search (Enter = pomin; bez uprawnien do platnych odsloniec): '),clay:await hidden('Clay klucz tylko odczyt istniejacych danych, jesli plan pozwala (Enter = pomin, bez zakupu): ')};
  const api=async(method,endpoint,payload)=>{
   const r=await fetch('https://automation.shadow-bridge.eu/api/v1'+endpoint,{method,headers:{'X-N8N-API-KEY':key,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Existing n8n rejected API scope or request');const text=await r.text();if(text.length>8*1024**2)throw Error('Response too large');return JSON.parse(text);
  };
  const workflows=[];
  for(const region of ['latam','asia','europe','report']){
   const url='https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/04ab380c197bce49fdfb69e726946fa1f7cfccbc/automation/nightly-global/'+region+'.json';
   const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Cannot read pinned inactive workflow');workflows.push(await r.json());
  }
  workflows.push(crmGuardWorkflow('apollo'),crmGuardWorkflow('clay'));
  const report=await provisionInactive({api,providers,workflows,state,save:s=>writeFile(stateFile,JSON.stringify(s,null,2)+'\n',{mode:0o600})});
  console.log(JSON.stringify({...report,checkpoint:stateFile,warning:'Keys stored, not provider API entitlement or billing verification. Clay read API/headers require actual contract confirmation. CRM and paid gates remain disabled.'},null,2));
 }finally{await lock.close();await unlink(stateFile+'.lock');}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('BLOCKED. No active workflow or provider operation was requested. Keep the private checkpoint; do not retry uncertain writes or publish keys.');process.exitCode=2;});
