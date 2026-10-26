// Read-only metadata for the stopped SMTP operator. Never invokes the updater.
import {lstat,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const release='cbca6a0c4ef9559081aaac7347370a774331b8ea';
const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});
async function meta(p){try{const s=await lstat(p);return{exists:true,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':s.isFile()?'file':'other',mode:(s.mode&511).toString(8),uid:s.uid,bytes:s.size};}catch(e){return{exists:e.code==='ENOENT'?false:null,error:e.code==='ENOENT'?undefined:'READ_FAILED'};}}
async function state(p){const m=await meta(p);if(!m.exists||m.type!=='file'||m.mode!=='600')return{file:m};try{const s=JSON.parse(await readFile(p,'utf8'));const out={file:m,phase:/^[A-Z_]{1,80}$/.test(s.phase||'')?s.phase:'UNKNOWN'};for(const k of ['operatorRelease','runtime','baselineRelease'])if(/^[a-f0-9]{40}$/.test(s[k]||''))out[k]=s[k];for(const k of ['offsiteVerified','smtpAuthVerified','confirmationVerified','recoveryVerified','rollbackVerified','ownerInteractiveAcceptance'])out[k]=s[k]===true;return out;}catch{return{file:m,status:'STATE_UNREADABLE_OR_INVALID'};}}
export async function inspectStoppedSmtp({operatorRoot='/opt/shadowbridge-operators',liveRoot='/opt/shadowbridge',transferRoot='/home/shadowadmin',readCommand=run}={}){
const dir=operatorRoot+'/smtp-'+release;const pkg=dir+'/.local/smtp-package-'+release;
const out={kind:'smtp-blocked-read-only-diagnostic',readOnly:true,changesMade:false,operatorRelease:release,operatorDirectory:await meta(dir),operatorScript:await meta(dir+'/scripts/smtp-production-operator.mjs')};
if(out.operatorDirectory.type==='directory'){try{const h=readCommand('git',['-c','safe.directory='+dir,'-C',dir,'rev-parse','HEAD']).trim();out.checkout={head:/^[a-f0-9]{40}$/.test(h)?h:null,matches:h===release};}catch{out.checkout={status:'HEAD_UNREADABLE_OR_PARTIAL_BOOTSTRAP'};}}
out.checkpoint=await state(pkg+'/operator-state.json');
out.publishedStatus=await state(transferRoot+'/.shadowbridge-smtp-'+release+'/status.json');
out.lock=await meta(liveRoot+'/.local/smtp-operator-lock/operation.lock');
out.artifacts={};for(const f of ['baseline.compose.json','candidate.compose.json','manifest.json','seal.json','smtp-credential.env','database.sbb','database.key','configuration.sbb','configuration.key','certificates.sbb','certificates.key'])out.artifacts[f]=await meta(pkg+'/'+f);
try{const ids=readCommand('docker',['--context','default','ps','-q']).trim().split('\n').filter(Boolean);const all=ids.length?JSON.parse(readCommand('docker',['--context','default','inspect',...ids])):[];out.apps=all.filter(c=>c.Config.Labels?.['com.docker.compose.service']==='app').map(c=>{const env=Object.fromEntries((c.Config.Env||[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));return{image:c.Image,running:c.State.Running,health:c.State.Health?.Status||null,release:/^[a-f0-9]{40}$/.test(env.RELEASE_SHA||'')?env.RELEASE_SHA:null,mailMode:['disabled','allowlist','smtp','captured'].includes(env.MAIL_DELIVERY_MODE)?env.MAIL_DELIVERY_MODE:'UNKNOWN'};});}catch{out.runtimeStatus='DOCKER_READ_FAILED';}
return out;
}
