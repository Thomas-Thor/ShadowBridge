// Local OWNER launcher. Reuses the immutable R1 installer; never deploys this
// acquisition branch, enables schedules, calls providers or accepts API keys.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir,hostname,platform} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const pins=Object.freeze({
 release:'236e04bded81c406fb49ee0950ae20d139f257ec',
 previousRelease:'d5582ffd9f1e7f9a40a1a49f9e16a304eae64a4e',
 installerSha256:'5246b80d4da349039a13df4bcbb2ba627b9f185051b1c75c1f78d17331038e1d',
 readinessRelease:'d3e10071906e85911e9d5c5b74c4b7168027fba2',
 readinessSha256:'a3e6503c2c3c45bd68fd89edd3bdb5da39e43255115dd6f3381873240c44312b',
 server:'shadowadmin@169.58.232.69'
});
const must=(v,m)=>{if(!v)throw Error(m);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const raw=(sha,file)=>`https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/${sha}/${file}`;
async function bounded(response,maximum){
 const parts=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;must(length<=maximum,'Odpowiedź przekracza limit.');parts.push(Buffer.from(chunk));}
 return Buffer.concat(parts);
}
export async function verifiedScript(url,sha256,fetcher=fetch){
 must(/^https:\/\/raw\.githubusercontent\.com\/Thomas-Thor\/ShadowBridge\/[a-f0-9]{40}\/[a-zA-Z0-9/._-]+\.mjs$/.test(url),'Wymagany przypięty skrypt repozytorium.');
 must(/^[a-f0-9]{64}$/.test(sha256),'Wymagana suma SHA-256.');
 const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 must(r.status===200,'Nie pobrano przypiętego skryptu.');
 const bytes=await bounded(r,256*1024);must(digest(bytes)===sha256,'STOP: suma skryptu nie zgadza się.');return bytes;
}
export function readinessCommand(bytes){
 must(digest(bytes)===pins.readinessSha256,'Nieprawidłowy odczytowy kolektor.');
 // Only this newly created temporary script is removed. Existing worktrees,
 // containers, backups, configuration and data are never written here.
 return `set -eu
umask 077
test "$(hostname)" = vmi3682957
SB_READONLY_FILE=$(mktemp /tmp/shadowbridge-readonly.XXXXXX.mjs)
trap 'rm -f -- "$SB_READONLY_FILE"' EXIT
printf '%s' '${bytes.toString('base64')}' | base64 --decode > "$SB_READONLY_FILE"
printf '%s  %s\\n' '${pins.readinessSha256}' "$SB_READONLY_FILE" | sha256sum --check --status
node "$SB_READONLY_FILE" </dev/null`;
}
export function summarizeReadiness(value){
 const n=value?.n8n;
 if(value?.readOnly!==true||value?.changesMade!==false||n?.container!=='shadowbridge-automation-n8n-1')return {status:'UNVERIFIED',changesMade:false};
 const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
 const status=v=>Number.isInteger(v)&&v>=100&&v<=599?v:null;
 return {status:n.running&&n.healthOk?'EXISTING_N8N_OBSERVED':'N8N_NOT_PROVEN',changesMade:false,
  running:n.running===true,healthOk:n.healthOk===true,
  version:/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(n.version||'')?n.version:null,
  workflowReadStatus:status(n.publicApi?.workflowReadStatus),
  workflowCountInspected:count(n.workflowCountInspected),
  keySupplied:n.publicApi?.keySupplied===true,
  providerReferences:Object.fromEntries(['apollo','clay','relevance'].map(p=>[p,count(n.providerReferences?.[p])])),
  providerApiEntitlementsVerified:false,providerCreditsVerified:false,crmMachineSinkVerified:false,
  note:'Brak klucza jest dozwolony. Odczyt bez klucza nie potwierdza praw workflow ani dostępu Apollo/Clay.'};
}
export async function publicEvidence(fetcher=fetch){
 const read=async(url,accept)=>{
  try{
   const r=await fetcher(url,{headers:{Accept:accept},redirect:'error',signal:AbortSignal.timeout(12000)});
   const b=await bounded(r,1024*1024);let json=null;
   if(accept==='application/json')try{json=JSON.parse(b.toString());}catch{}
   // No response bodies, cookies or CSRF tokens enter the report.
   return {httpsResponseReceived:true,http:r.status,release:r.headers.get('x-shadowbridge-release'),
    healthOk:json?.ok===true,statusOk:json?.status==='ok',backendEnabled:json?.backendEnabled===true,
    configRelease:json?.releaseSha,code:json?.code,html:/^text\/html\b/i.test(r.headers.get('content-type')||'')};
  }catch{return {httpsResponseReceived:false,http:null};}
 };
 const [health,config,book,n8n,signin]=await Promise.all([
  read('https://shadow-bridge.eu/health','application/json'),
  read('https://shadow-bridge.eu/api/config','application/json'),
  read('https://shadow-bridge.eu/api/integrations/owner-book/v1/entries?kind=note','application/json'),
  read('https://automation.shadow-bridge.eu/healthz','application/json'),
  read('https://automation.shadow-bridge.eu/signin','text/html')
 ]);
 const releaseVerified=health.http===200&&health.healthOk&&health.release===pins.release&&config.http===200&&config.backendEnabled&&config.configRelease===pins.release&&book.release===pins.release;
 return {release:health.release&&/^[a-f0-9]{40}$/.test(health.release)?health.release:null,
  releaseVerified,healthStatus:health.http,configStatus:config.http,bookAnonymousStatus:book.http,
  bookAnonymousGateVerified:releaseVerified&&book.http===401&&book.code==='BOOK_API_DENIED',
  bookKnownDisabled:book.http===503&&book.code==='BOOK_API_DISABLED',
  authorizedBookReadVerified:false,chatgptConnected:false,
  n8nHealthVerified:n8n.http===200&&n8n.statusOk,
  n8nSignInHtmlVerified:signin.http===200&&signin.html,
  tlsPolicy:'Default certificate verification; redirects refused; failed transport is UNVERIFIED, not a service failure.'};
}
export async function main({apply=false}={}){
 if(!apply){console.log(JSON.stringify({status:'DRY_RUN_NO_NETWORK',release:pins.release,
  steps:['existing R1 installer with --book-api','public HTTPS anonymous gate checks','existing n8n read-only inventory without credentials'],
  providerCalls:0,paidOperations:0,workflowActivation:false,crmWrites:0,chatgptConnected:false},null,2));return;}
 must(platform()==='linux'&&hostname()!=='vmi3682957'&&process.stdin.isTTY,'Uruchom w prywatnym terminalu na komputerze Linux OWNER, nie na VPS.');
 must(Number(process.versions.node.split('.')[0])>=22&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','Wymagany Node >=22 i aktywna weryfikacja TLS.');
 const [installer,collector]=await Promise.all([
  verifiedScript(raw(pins.release,'scripts/r1-owner-deploy.mjs'),pins.installerSha256),
  verifiedScript(raw(pins.readinessRelease,'automation/nightly-global/collect-readiness.mjs'),pins.readinessSha256)
 ]);
 const dir=await mkdtemp(path.join(tmpdir(),'shadowbridge-owner-next-')),file=path.join(dir,'r1-owner-deploy.mjs');
 await writeFile(file,installer,{mode:0o600});
 console.log('Uruchamiam istniejący instalator API z kontrolą SHA, backupem poza VPS i odbiorem OWNER. Nie przekazuj żadnego klucza API.');
 const update=spawnSync(process.execPath,[file,'--release='+pins.release,'--book-api'],{stdio:'inherit'});
 // A signal or a failed update must not trigger additional automatic actions.
 if(update.error||update.signal||update.status!==0){
  console.log(JSON.stringify({status:'UPDATE_STOPPED_CHECK_EXISTING_CHECKPOINT',release:pins.release,
   installer:file,canaryExecuted:false,providerCalls:0,crmWrites:0},null,2));process.exitCode=2;return;
 }
 const external=await publicEvidence();
 const inventory=spawnSync('ssh',['-T','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15',pins.server,readinessCommand(collector)],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
 let n8n={status:'UNVERIFIED',changesMade:false};
 if(!inventory.error&&!inventory.signal&&inventory.status===0)try{n8n=summarizeReadiness(JSON.parse(inventory.stdout));}catch{}
 const report={kind:'shadowbridge-owner-next-step-v1',collectedAt:new Date().toISOString(),timezone:'Europe/Oslo',
  status:external.bookAnonymousGateVerified?'API_GATE_VERIFIED_AUTHORIZED_READ_PENDING':'API_ACTIVATION_UNVERIFIED',
  approvedRelease:pins.release,external,n8n,
  acquisition:{canaryExecuted:false,realCrmRecordsInserted:0,providerCallsByThisLauncher:0,
   paidOperations:0,actualAccountCredits:null,schedulesActivated:false,
   blockers:['N8N_PROVIDER_API_ENTITLEMENTS_AND_BALANCES','R1_DOES_NOT_YET_INCLUDE_ACQUISITION_GATEWAY','CRM_GUARD_NOT_PROVEN_DEPLOYED','SOURCE_CONTRACT_AND_CANARY_APPROVAL']},
  chatgpt:{readOnlyFirst:true,authorizedReadVerified:false,writeAllowed:false,connected:false},
  retainedInstaller:file,emergencyDisable:`node ${JSON.stringify(file)} --release=${pins.release} --book-api --disable`};
 const reportFile=path.join(dir,'result.json');await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));console.log('Raport bez sekretów: '+reportFile);
 if(!external.bookAnonymousGateVerified)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).some(a=>a!=='--apply')||process.argv.length>3){console.error('Użyj bez argumentów (dry run) lub --apply na komputerze OWNER.');process.exitCode=2;}
 else main({apply:process.argv.includes('--apply')}).catch(()=>{console.error('STOP. Nie potwierdzono wykonania. Zachowaj checkpoint; żadnego resetu, ponowienia zakupów ani sekretów w rozmowie.');process.exitCode=2;});
}
