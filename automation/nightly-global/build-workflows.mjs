import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {acquisition} from './core.mjs';
const expression=(action,args)=>`={{ (${acquisition.toString()})(${JSON.stringify(action)}, ${args}) }}`;
export function build(region,hour){
 const nodes=[],connections={};
 const add=(name,type,version,parameters,extra={})=>{nodes.push({id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,type:'n8n-nodes-base.'+type,typeVersion:version,position:[(nodes.length%7)*270,Math.floor(nodes.length/7)*240],parameters,...extra});};
 const link=(a,b,output=0)=>{connections[a]||={main:[]};connections[a].main[output]||=[];connections[a].main[output].push({node:b,type:'main',index:0});};
 const set=(name,field,value,type='object')=>add(name,'set',3.4,{assignments:{assignments:[{id:field,name:field,type,value}]},options:{}});
 const branch=(name,value)=>add(name,'if',2.2,{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'allowed',leftValue:value,rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
 const pg=(name,query,replacements)=>add(name,'postgres',2.6,{operation:'executeQuery',query,options:{queryReplacement:replacements,queryBatching:'single'}},{credentials:{postgres:{id:'OWNER_SELECT_SCOPED_'+region,name:'ShadowBridge acquisition '+region+' - existing PostgreSQL'}}});
 add('Manual review','manualTrigger',1,{});
 add('Oslo '+String(hour).padStart(2,'0')+'00','scheduleTrigger',1.2,{rule:{interval:[{field:'cronExpression',expression:`0 ${hour} * * *`}]}});
 if(region!=='REPORT')add('Resume unfinished jobs','scheduleTrigger',1.2,{rule:{interval:[{field:'cronExpression',expression:`15,30,45 ${hour}-7 * * *`}]}},{disabled:true});
 set('OWNER approval gate','enabled',false,'boolean');branch('Approved for execution','={{ $json.enabled === true }}');
 set('Disabled safely','readiness',{status:'DISABLED_REQUIRES_OWNER_APPROVAL',liveRecordsAcquired:null,apiUsageVerified:false,paidEnrichmentEnabled:false});
 link('Manual review','OWNER approval gate');link('Oslo '+String(hour).padStart(2,'0')+'00','OWNER approval gate');if(region!=='REPORT')link('Resume unfinished jobs','OWNER approval gate');
 link('OWNER approval gate','Approved for execution');link('Approved for execution','Disabled safely',1);
 if(region==='REPORT'){
  pg('Read private aggregate report','SELECT acquisition_ops.owner_report($1::date) AS report','={{ [$now.setZone("Europe/Oslo").toISODate()] }}');
  set('OWNER summary without long dash','text',expression('reportText','{report:$json.report}'),'string');
  link('Approved for execution','Read private aggregate report');link('Read private aggregate report','OWNER summary without long dash');
 }else{
  pg('Claim next bounded page','SELECT acquisition_ops.claim($1::text) AS job',`={{ [${JSON.stringify(region)}] }}`);
  branch('Page lease acquired','={{ $json.job.fetch === true }}');
  set('Build verified read request','request',expression('request','{job:$("Claim next bounded page").item.json.job}'));
  const types=['apollo','clay','relevance'];
  for(let i=0;i<types.length;i++){
   const provider=types[i],check='Source '+provider,http='Read '+provider+' approved results',ctx='Preserve '+provider+' page';
   branch(check,`={{ $json.request.provider === ${JSON.stringify(provider)} }}`);
   add(http,'httpRequest',4.2,{method:'={{ $json.request.method }}',url:'={{ $json.request.endpoint }}',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:'={{ $json.request.method === "POST" }}',specifyBody:'json',jsonBody:'={{ $json.request.body }}',options:{timeout:15000,redirect:{redirect:{followRedirects:false}},response:{response:{fullResponse:true,neverError:true,responseFormat:'text',outputPropertyName:'body'}}}},{retryOnFail:false,onError:'continueRegularOutput',credentials:{httpHeaderAuth:{id:'OWNER_SELECT_EXISTING_'+provider.toUpperCase(),name:'Existing '+provider+' approved read credential'}}});
   set(ctx,'context','={{ {job:$("Claim next bounded page").item.json.job,response:$json} }}');
   link(check,http);link(http,ctx);link(ctx,'Normalize bounded page');
   if(i<2)link(check,'Source '+types[i+1],1);else link(check,'Unsupported source blocked',1);
  }
  add('Unsupported source blocked','stopAndError',1,{errorMessage:'Source provider not approved; lease will expire, no cursor advanced.'});
  set('Normalize bounded page','page',expression('page','{job:$json.context.job,response:$json.context.response,now:$now.toISO()}'));
  pg('Commit page and checkpoint','SELECT acquisition_ops.commit_page($1::bigint,$2::uuid,$3::jsonb) AS committed','={{ [$("Claim next bounded page").item.json.job.id,$("Claim next bounded page").item.json.job.lease,JSON.stringify($json.page)] }}');
  add('Gentle spacing','wait',1.1,{amount:2,unit:'seconds'},{webhookId:'shadowbridge-global-spacing-'+region.toLowerCase()});
  set('Region checkpoint','state',{scope:region,targetCombinedNight:1000,crmDelivery:'BLOCKED_VAULT_V3',sourceRecords:'inspect private operational report, never infer acquisition from execution success'});
  link('Approved for execution','Claim next bounded page');link('Claim next bounded page','Page lease acquired');link('Page lease acquired','Build verified read request');link('Page lease acquired','Region checkpoint',1);link('Build verified read request','Source apollo');link('Normalize bounded page','Commit page and checkpoint');link('Commit page and checkpoint','Gentle spacing');link('Gentle spacing','Claim next bounded page');
 }
 return{name:'ShadowBridge Global '+region+' '+String(hour).padStart(2,'0')+':00 Oslo',active:false,nodes,connections,settings:{timezone:'Europe/Oslo',executionOrder:'v1',executionTimeout:21600,saveDataErrorExecution:'none',saveDataSuccessExecution:region==='REPORT'?'all':'none',saveManualExecutions:region==='REPORT',saveExecutionProgress:false},pinData:{},tags:[]};
}
export const workflows=()=>[['LATAM',1],['ASIA',2],['EUROPE',3],['REPORT',8]].map(([region,hour])=>({region,workflow:build(region,hour)}));
if(process.argv[1]===fileURLToPath(import.meta.url))for(const {region,workflow}of workflows())await writeFile(new URL('./'+region.toLowerCase()+'.json',import.meta.url),JSON.stringify(workflow,null,2)+'\n');
