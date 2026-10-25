// Independent, read-only companion. Never invokes the deployment installer or
// reads OWNER notes/credentials through an unapproved channel.
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir,hostname,platform} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pins,verifiedScript,readinessCommand,summarizeReadiness,publicEvidence} from './owner-next-step.mjs';

export async function collectReadinessOnly({readCollector,inspectN8n,inspectPublic}){
 const bytes=await readCollector();
 // Validate the immutable collector before handing any command to SSH.
 const command=readinessCommand(bytes);
 const n8n=summarizeReadiness(await inspectN8n(command));
 const external=await inspectPublic();
 return {kind:'shadowbridge-independent-read-only-check',collectedAt:new Date().toISOString(),timezone:'Europe/Oslo',
  status:'BLOCKED_FOR_CANARY',readOnly:true,productionUpdated:false,migrationsRun:false,
  n8n,external,
  book:{scopeSource:'NOT_READ',authenticatedRead:false,reportWritten:false},
  canary:{preparedScope:false,scheduled:false,executed:false,startAt:null,newCrmRecords:0,
   maxRecords:null,maxCredits:0,paidOperations:0,providerBalancesVerified:false,
   blockers:['BOOK_SCOPE_NOT_READ','PROVIDER_API_CONNECTIONS_AND_CURRENT_CREDITS_UNVERIFIED','CENTRAL_CRM_DELIVERY_UNVERIFIED']},
  note:'This collector checks existing n8n only. It never starts a workflow or provider request. Missing facts remain blockers.'};
}
export async function main({readOnly=false}={}){
 if(!readOnly){console.log(JSON.stringify({status:'DRY_RUN_NO_NETWORK',mode:'READ_ONLY_ONLY',productionUpdated:false,workflowActivation:false,providerCalls:0}));return;}
 if(platform()!=='linux'||hostname()==='vmi3682957'||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Run on OWNER Linux computer with verified TLS.');
 const report=await collectReadinessOnly({
  readCollector:()=>verifiedScript('https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/'+pins.readinessRelease+'/automation/nightly-global/collect-readiness.mjs',pins.readinessSha256),
  inspectPublic:()=>publicEvidence(),
  inspectN8n:async command=>{
   const p=spawnSync('ssh',['-T','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15',pins.server,command],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
   if(p.error||p.signal||p.status!==0)return {};
   try{return JSON.parse(p.stdout);}catch{return {};}
  }
 });
 const dir=await mkdtemp(path.join(tmpdir(),'shadowbridge-readiness-only-')),file=path.join(dir,'result.json');
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({...report,reportFile:file},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length>1||args.length===1&&args[0]!=='--read-only'){console.error('Use --read-only or no argument for dry run.');process.exitCode=2;}
 else main({readOnly:args.includes('--read-only')}).catch(()=>{console.error('BLOCKED: read-only inspection incomplete. No deployment, source query or workflow activation requested.');process.exitCode=2;});
}
