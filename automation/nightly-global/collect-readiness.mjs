// ONE operator action, READ ONLY on the existing Contabo. No external provider
// calls, no imports, agent triggers, DB queries, credential exports or changes.
import {execFileSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {availableParallelism,totalmem,freemem} from 'node:os';
import https from 'node:https';
const execute=(args,input)=>execFileSync('docker',['--context','default',...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000,maxBuffer:1024**2}).trim();
const field=(c,k)=>(c.Config.Env||[]).find(v=>v.startsWith(k+'='))?.slice(k.length+1)||null;
export async function optionalKey(){
 if(!process.stdin.isTTY)return null;
 process.stdout.write('Istniejacy klucz API n8n do odczytu (ukryty, Enter = brak; nie tworz nowego): ');process.stdin.setRawMode(true);process.stdin.resume();let value='';
 try{return await new Promise((resolve,reject)=>{const read=buf=>{for(const c of buf.toString()){if(c==='\u0003'){process.stdin.off('data',read);reject(new Error('CANCELLED'));return;}if(c==='\r'||c==='\n'){process.stdin.off('data',read);let key=value.trim();if(key.startsWith('\x1b[200~')&&key.endsWith('\x1b[201~'))key=key.slice(6,-6).trim();if(/[\x00-\x1f\x7f-\x9f]/.test(key)){reject(new Error('INVALID_HIDDEN_API_KEY'));return;}resolve(key||null);return;}if(c==='\u007f')value=value.slice(0,-1);else if(c>=' '||c==='\x1b'){if(value.length>=8192){process.stdin.off('data',read);reject(new Error('API_KEY_INPUT_TOO_LONG'));return;}value+=c;}}};process.stdin.on('data',read);});}
 finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}
const publicHealth=()=>new Promise(resolve=>{
 const q=https.get('https://automation.shadow-bridge.eu/healthz',{rejectUnauthorized:true,signal:AbortSignal.timeout(10000)},r=>{const tlsVerified=r.socket.authorized;let b='';r.on('data',p=>{if(b.length<4096)b+=p;});r.on('end',()=>{let ok=false;try{ok=r.statusCode===200&&JSON.parse(b).status==='ok';}catch{}resolve({ok,status:r.statusCode,tlsVerified,basicAuth:!!r.headers['www-authenticate']});});});q.on('error',()=>resolve({ok:false,error:'HTTPS_UNVERIFIED'}));
});
// Only selected aggregates leave the container. Raw workflow bodies/credentials
// and execution data never appear on stdout or in the returned report.
export const inspectApi=`const {createHash}=await import('node:crypto');const digest=v=>createHash('sha256').update(v).digest('hex');let raw='';for await(const b of process.stdin){raw+=b;if(raw.length>12000)process.exit(1);}const p=JSON.parse(raw);const headers=p.key?{'X-N8N-API-KEY':p.key}:{};const read=async path=>{const r=await fetch('http://127.0.0.1:5678'+path,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});const text=await r.text();let data={};if(text.length<5000000)try{data=JSON.parse(text)}catch(e){}return{status:r.status,data};};
const health=await read('/healthz');const settings=await read('/rest/settings');const out={healthOk:health.status===200&&health.data.status==='ok',version:settings.data?.data?.versionCli||null,publicApi:{keySupplied:!!p.key,workflowReadStatus:null,executionReadStatus:null,importPermissionVerified:false},providerReferences:{apollo:0,clay:0,relevance:0},workflowCountInspected:0,workflowListingComplete:false,workflowFamilies:{apollo:{workflows:0,active:0,boundCredentialNodes:0},clay:{workflows:0,active:0,boundCredentialNodes:0}},googleSheets:{nodeReferences:0,boundCredentialNodes:0,staticDocumentFingerprints:[],dynamicDocumentNodes:0,operations:{},writeNodeReferences:0,sourceAndSheetSameWorkflow:{apollo:0,clay:0},schemaVerified:false,writeReadVerified:false},existingFourScoutsVerified:false,providerCreditsVerified:false,crmMachineSinkVerified:false};
if(p.key){let cursor=null;for(let i=0;i<5;i++){
 const w=await read('/api/v1/workflows?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));out.publicApi.workflowReadStatus=w.status;if(w.status!==200||!Array.isArray(w.data.data))break;
 for(const f of w.data.data){out.workflowCountInspected++;const sources=new Set();let sheetInWorkflow=false;
  for(const n of f.nodes||[]){
   const candidate=JSON.stringify({type:n.type,name:n.name,url:n.parameters?.url,credentials:Object.keys(n.credentials||{})}).toLowerCase();
   const bound=Object.values(n.credentials||{}).some(v=>typeof v?.id==='string'&&v.id&&!v.id.startsWith('OWNER_SELECT_'));
   for(const provider of Object.keys(out.providerReferences))if(candidate.includes(provider)){out.providerReferences[provider]++;sources.add(provider);if(out.workflowFamilies[provider]&&bound)out.workflowFamilies[provider].boundCredentialNodes++;}
   if(n.type==='n8n-nodes-base.googleSheets'){
    sheetInWorkflow=true;out.googleSheets.nodeReferences++;if(bound)out.googleSheets.boundCredentialNodes++;
    const operation=n.parameters?.operation;const op=typeof operation==='string'&&/^[a-zA-Z]{1,40}$/.test(operation)?operation:'UNSPECIFIED_OR_DYNAMIC';out.googleSheets.operations[op]=(out.googleSheets.operations[op]||0)+1;
    if(['append','appendOrUpdate','update','appendOrUpdateRow'].includes(op))out.googleSheets.writeNodeReferences++;
    const doc=typeof n.parameters?.documentId==='string'?n.parameters.documentId:n.parameters?.documentId?.value;
    if(typeof doc==='string'&&doc&&!doc.includes('{{')){const h=digest(doc);if(!out.googleSheets.staticDocumentFingerprints.includes(h))out.googleSheets.staticDocumentFingerprints.push(h);}else out.googleSheets.dynamicDocumentNodes++;
   }
  }
  for(const provider of sources)if(out.workflowFamilies[provider]){out.workflowFamilies[provider].workflows++;if(f.active===true)out.workflowFamilies[provider].active++;if(sheetInWorkflow)out.googleSheets.sourceAndSheetSameWorkflow[provider]++;}
 }
 cursor=w.data.nextCursor;if(!cursor){out.workflowListingComplete=true;break;}
}const e=await read('/api/v1/executions?limit=20&includeData=false');out.publicApi.executionReadStatus=e.status;if(e.status===200&&Array.isArray(e.data.data)){out.recentExecutionStatuses={};for(const r of e.data.data)out.recentExecutionStatuses[r.status||'unknown']=(out.recentExecutionStatuses[r.status||'unknown']||0)+1;}}
process.stdout.write(JSON.stringify(out));`;
if(process.argv[1]===fileURLToPath(import.meta.url))try{
 if(await realpath('/opt/shadowbridge')!=='/opt/shadowbridge')throw new Error('WRONG_HOST');
 const context=JSON.parse(execFileSync('docker',['context','inspect','default','--format','{{json .Endpoints.docker}}'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(context.Host))throw new Error('REMOTE_CONTEXT_REFUSED');
 const c=JSON.parse(execute(['inspect','shadowbridge-automation-n8n-1']))[0];if(c.Name!=='/shadowbridge-automation-n8n-1'||!c.State.Running)throw new Error('EXISTING_N8N_NOT_RUNNING');
 const key=await optionalKey();const api=JSON.parse(execute(['exec','-i',c.Id,'node','--input-type=module','-e',inspectApi],JSON.stringify({key})));
 const report={kind:'shadowbridge-global-acquisition-read-only-readiness',collectedAt:new Date().toISOString(),readOnly:true,changesMade:false,hostResources:{cpuAvailable:availableParallelism(),memoryTotalBytes:totalmem(),memoryFreeBytes:freemem()},n8n:{container:c.Name.slice(1),imageId:c.Image,user:c.Config.User||'root',running:c.State.Running,executionMode:field(c,'EXECUTIONS_MODE')||'default_unconfirmed',databaseType:field(c,'DB_TYPE')||'default_sqlite_unconfirmed',timezone:field(c,'GENERIC_TIMEZONE')||field(c,'TZ')||'unconfirmed',memoryLimitBytes:c.HostConfig.Memory,cpuQuota:c.HostConfig.NanoCpus,zeroLimitMeans:'unlimited_by_container_not_zero_available_resources',ports:c.HostConfig.PortBindings,...api},publicHttps:await publicHealth(),accounts:{apollo:{apiEntitlement:'UNVERIFIED',remainingCredits:null},clay:{apiEntitlement:'UNVERIFIED',remainingCredits:null},relevance:{existingScoutsOwnerStated:4,verified:false,creditsPerRun:null}},activationApproved:false,blockingFacts:['CURRENT_PROVIDER_QUOTAS_AND_READ_CONTRACTS','EXISTING_FOUR_SCOUT_OUTPUTS_COST_AND_QUALITY','EXISTING_CRM_MACHINE_WRITE_CONTRACT']};
 console.log(JSON.stringify(report,null,2));
}catch{console.log(JSON.stringify({status:'BLOCKED',readOnly:true,changesMade:false,reason:'Could not inspect the existing Contabo n8n safely. No service was installed, started or modified.'},null,2));process.exitCode=2;}
