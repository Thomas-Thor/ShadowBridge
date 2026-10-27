// One real, bounded ingestion workflow. No schedules or Clay API entitlement
// assumptions. The existing private CRM ID is supplied outside public Git.
import {claySheetsCanary} from './clay-sheets-canary.mjs';
export function buildClayCanary({spreadsheetId,sheetTitle='',googleCredentialId='OWNER_SELECT_GOOGLE_SHEETS',ingestCredentialId='OWNER_SELECT_PRIVATE_INGEST',webhookPath='shadowbridge-global-b2b-sourcing-v1-canary'}={}){
 if(!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId||'')||typeof sheetTitle!=='string'||sheetTitle.length>200)throw Error('PRIVATE_EXISTING_CRM_CONFIGURATION_REQUIRED');
 for(const v of [googleCredentialId,ingestCredentialId,webhookPath])if(!/^[A-Za-z0-9_-]{1,100}$/.test(v||''))throw Error('CANARY_BINDING_INVALID');
 const nodes=[],connections={},fn=claySheetsCanary.toString(),base='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId;
 const add=(name,type,version,parameters,extra={})=>{nodes.push({id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,type:'n8n-nodes-base.'+type,typeVersion:version,position:[(nodes.length%5)*280,Math.floor(nodes.length/5)*240],parameters,...extra});};
 const link=(x,y,port=0)=>{connections[x]||={main:[]};connections[x].main[port]||=[];connections[x].main[port].push({node:y,type:'main',index:0});};
 const code=(name,action,args)=>add(name,'code',2,{mode:'runOnceForAllItems',jsCode:'return [{json:('+fn+')('+JSON.stringify(action)+','+args+')}];'},{onError:'continueErrorOutput'});
 const branch=(name,expr)=>add(name,'if',2.2,{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:'yes',leftValue:expr,rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
 const http=(name,url,method='GET',body)=>add(name,'httpRequest',4.2,{method,url,authentication:'predefinedCredentialType',nodeCredentialType:'googleSheetsOAuth2Api',...(body?{sendBody:true,specifyBody:'json',jsonBody:body}:{}),options:{timeout:15000,redirect:{redirect:{followRedirects:false}},response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}}},{credentials:{googleSheetsOAuth2Api:{id:googleCredentialId,name:'Existing private Google Sheets CRM'}},retryOnFail:false,onError:'continueErrorOutput'});
 const rangeUrl='={{ '+JSON.stringify(base+'/values/')+' + encodeURIComponent($("Choose existing tab").first().json.range) }}';
 add('Private Clay export intake','webhook',2,{httpMethod:'POST',path:webhookPath,authentication:'headerAuth',responseMode:'responseNode',options:{}},{webhookId:'shadowbridge-b2b-canary-v1',credentials:{httpHeaderAuth:{id:ingestCredentialId,name:'Private sourcing canary ingress'}}});
 code('Validate maximum five rows','validate','{body:$input.first().json.body,now:new Date().toISOString()}');
 http('Read existing CRM metadata',base+'?fields=sheets.properties');
 code('Choose existing tab','sheet','{response:$input.first().json,sheetTitle:'+JSON.stringify(sheetTitle)+'}');
 http('Read current CRM rows',rangeUrl);
 code('Dedupe and plan append','plan','{response:$input.first().json,request:$("Validate maximum five rows").first().json}');
 branch('Preview only','={{ $json.mode === "preview" || $json.mode === "inspect" }}');
 code('Private preview counts','preview','{plan:$input.first().json}');
 branch('Append is needed','={{ $json.canWrite === true }}');
 http('Append only missing rows',rangeUrl.slice(0,-3)+' + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS" }}','POST','={{ $("Dedupe and plan append").first().json.appendBody }}');
 code('Check append receipt','appendAck','{response:$input.first().json,plan:$("Dedupe and plan append").first().json}');
 http('Read back CRM rows',rangeUrl);
 code('Verify counts without private records','verify','{response:$input.first().json,plan:$("Dedupe and plan append").first().json}');
 add('Sanitize failure','code',2,{mode:'runOnceForAllItems',jsCode:'const e=$input.first().json.error;const m=typeof e==="string"?e:(e?.message||"");return [{json:{status:"BLOCKED",reason:/^(?:CANARY_|CRM_|GOOGLE_SHEETS_)[A-Z0-9_]{1,110}$/.test(m)?m:"CANARY_NODE_FAILED_NO_AUTOMATIC_RETRY",automaticRetry:false,sourcingScheduled:false}}];'});
 add('Private response','respondToWebhook',1.4,{respondWith:'json',responseBody:'={{ $json }}',options:{responseCode:'={{ $json.status === "BLOCKED" ? 409 : 200 }}'}});
 for(const[x,y]of [['Private Clay export intake','Validate maximum five rows'],['Validate maximum five rows','Read existing CRM metadata'],['Read existing CRM metadata','Choose existing tab'],['Choose existing tab','Read current CRM rows'],['Read current CRM rows','Dedupe and plan append'],['Dedupe and plan append','Preview only'],['Preview only','Private preview counts'],['Private preview counts','Private response'],['Append is needed','Append only missing rows'],['Append only missing rows','Check append receipt'],['Check append receipt','Read back CRM rows'],['Read back CRM rows','Verify counts without private records'],['Verify counts without private records','Private response']])link(x,y);
 link('Preview only','Append is needed',1);link('Append is needed','Read back CRM rows',1);
 for(const n of nodes)if(n.onError==='continueErrorOutput')link(n.name,'Sanitize failure',1);link('Sanitize failure','Private response');
 return{name:'ShadowBridge Global B2B Sourcing V1',active:false,nodes,connections,settings:{timezone:'Europe/Oslo',executionOrder:'v1',executionTimeout:120,saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false},pinData:{},tags:[]};
}
