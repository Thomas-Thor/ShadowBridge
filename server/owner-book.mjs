import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {ApiError,object,text,oneOf,identifier} from './validation.mjs';

export const bookKinds=Object.freeze(['task','note','idea','event','decision']);
export const bookScopes=Object.freeze([...bookKinds.flatMap(k=>[k+'.read',k+'.write']),'journal.read','summary.export','records.import']);
const priorities=['low','normal','high','critical'],statuses=['planned','open','in_progress','blocked','done','cancelled','recorded'];
const invalid=m=>{throw new ApiError(400,'BOOK_INVALID_INPUT',m);};
function commandUuid(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))invalid('Use a stable command UUID for this one explicit instruction.');return value;}
function timestamp(v,name){if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))invalid('Use an ISO timestamp with an explicit offset for '+name+'.');return new Date(v).toISOString();}
export function bookRecord(input,{update=false,id}={}){
 const p=object(input,['kind','title','body','priority','status','due_at','starts_at','ends_at','remind_at','archived','dependencies','source_ref','version'],['kind','title']);
 const kind=oneOf(p.kind,bookKinds,'resource kind'),title=text(p.title,'title',{min:1,max:200}),content=text(p.body??'','body',{max:5000});
 if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{30,}|(?:sbob_|sboa_|sbor_|sbocc_|sbocs_)[A-Za-z0-9_-]{43}/i.test(title+' '+content+' '+(p.source_ref??'')))invalid('Use the separate password manager for access secrets.');
 if(update&&(!Number.isSafeInteger(p.version)||p.version<1))invalid('Use the current entry version.');if(!update&&p.version!==undefined)invalid('An import/create cannot overwrite an existing version.');
 if(p.archived!==undefined&&typeof p.archived!=='boolean')invalid('Invalid archive flag.');
 const deps=p.dependencies??[];if(!Array.isArray(deps)||deps.length>20)invalid('Use at most 20 task dependencies.');
 const result={kind,title,body:content,priority:oneOf(p.priority??'normal',priorities,'priority'),status:oneOf(p.status??(kind==='event'?'planned':kind==='decision'?'recorded':'open'),statuses,'status'),archived:p.archived??false,dependencies:[...new Set(deps.map(identifier))],source_ref:text(p.source_ref??'','source reference',{max:500})};
 for(const name of ['due_at','starts_at','ends_at','remind_at'])result[name]=timestamp(p[name],name);
 if(kind!=='task'&&result.dependencies.length)invalid('Dependencies apply to tasks only.');
 if(kind==='event'&&!result.starts_at||result.ends_at&&(!result.starts_at||result.ends_at<result.starts_at))invalid('Calendar events require a start and a valid end.');
 if(update)Object.assign(result,{id:identifier(id),version:p.version});return result;
}
export function importRecords(input){
 object(input,['items','content','format','sourceRef','requestKey','confirm'],[]);
 let records=input.items;
 if(input.content!==undefined){
  if(typeof input.content!=='string'||input.content.length>50000)invalid('Import is limited to 50,000 characters.');
  if(input.format==='json'){try{records=JSON.parse(input.content);}catch{invalid('Invalid import JSON.');}}
  else if(input.format==='text')records=[{kind:'note',title:'Imported previous agreements',body:input.content}];
  else invalid('Choose text or JSON import.');
 }
 if(!Array.isArray(records)||records.length<1||records.length>25)invalid('Import 1 to 25 new entries at a time.');
 return records.map(p=>bookRecord({...p,...(input.sourceRef?{source_ref:text(input.sourceRef,'source reference',{max:500})}:{})}));
}
function params(url,allowed){const p={};for(const [k,v]of url.searchParams){if(!allowed.includes(k)||Object.hasOwn(p,k))invalid('Unknown or repeated book filter.');p[k]=v;}return p;}
function page(p){if(p.page!==undefined&&(!/^[1-9][0-9]{0,3}$/.test(p.page)||Number(p.page)>10000))invalid('Invalid page.');return p;}
export function bookOperation(url,method,input={},prefix='/api/owner/book'){
 const route=url.pathname.slice(prefix.length),query=url.searchParams;
 if(method==='GET'&&route==='/entries'){const p=page(params(url,['kind','page','q','status','archived','from','until']));const kind=oneOf(p.kind,bookKinds,'kind');delete p.kind;for(const k of ['from','until'])if(p[k])p[k]=timestamp(p[k],k);return {action:'list',kind,p};}
 const detail=route.match(/^\/entries\/([a-f0-9-]+)(\/history)?$/i);
 if(method==='GET'&&detail){const p=page(params(url,['kind','page'])),kind=oneOf(p.kind,bookKinds,'kind');delete p.kind;return{action:detail[2]?'history':'get',kind,p:{...p,id:identifier(detail[1])}};}
 if(method==='GET'&&route==='/journal')return{action:'journal',kind:null,p:page(params(url,['window','page']))};
 if(method==='GET'&&route==='/export'){const p=params(url,['kinds']),kinds=(p.kinds||'').split(',');for(const k of kinds)oneOf(k,bookKinds,'export resource');return{action:'export',kind:null,p:{kinds:[...new Set(kinds)]}};}
 if(method==='GET'&&['/config','/summary','/keys','/audit'].includes(route)){if(query.size)invalid('Unexpected query parameters.');return{action:{'/config':'config','/summary':'summary','/keys':'key_list','/audit':'audit'}[route],kind:null,p:{}};}
 if(query.size)invalid('Writes do not accept query parameters.');
 if(method==='POST'&&route==='/entries'||method==='PUT'&&detail&&!detail[2]){
  object(input,['entry','requestKey'],['entry','requestKey']);const p=bookRecord(input.entry,{update:method==='PUT',id:detail?.[1]});return{action:'save',kind:p.kind,p,commandId:commandUuid(input.requestKey)};
 }
 if(method==='POST'&&['/import','/import/preview'].includes(route)){
  const items=importRecords(input);if(route==='/import/preview')return{action:'preview',kind:null,p:{},preview:items};
  if(input.confirm!==true)invalid('Review and explicitly confirm the import.');return{action:'import',kind:null,p:{items},commandId:commandUuid(input.requestKey)};
 }
 if(method==='POST'&&route==='/keys'){
  object(input,['name','mode','scopes','expiresAt'],['name','mode','expiresAt']);const mode=oneOf(input.mode,['read_only','custom','book_admin'],'key mode');
  let scopes=input.scopes??bookKinds.map(k=>k+'.read');if(!Array.isArray(scopes)||scopes.some(k=>!bookScopes.includes(k))||mode!=='book_admin'&&!scopes.length||mode==='read_only'&&scopes.some(k=>!k.endsWith('.read')))invalid('Use only the permitted Command Book scopes.');if(mode==='book_admin')scopes=[...bookScopes];
  return{action:'key_create',kind:null,p:{name:text(input.name,'key name',{min:2,max:80}),mode,scopes:[...new Set(scopes)],expiresAt:timestamp(input.expiresAt,'expiry')}};
 }
 const revoke=route.match(/^\/keys\/([a-f0-9-]+)\/revoke$/i);
 if(method==='POST'&&revoke){object(input,[],[]);return{action:'key_revoke',kind:null,p:{id:identifier(revoke[1])}};}
 throw new ApiError(404,'BOOK_NOT_FOUND','Command Book endpoint not found.');
}
export async function routeOwnerBook({req,url,tx,body,config}){
 const requestId=randomUUID();
 const op=bookOperation(url,req.method,['GET','HEAD'].includes(req.method)?{}:await body(req));
 let token;if(op.action==='key_create'){token='sbob_'+randomBytes(32).toString('base64url');op.p.tokenHash=createHash('sha256').update(token).digest('hex');}
 const routed=(await tx.query('SELECT owner_book.owner_rpc($1,$2,$3::jsonb,$4::uuid,$5::uuid) AS result',[op.action,op.kind,JSON.stringify(op.p),requestId,op.commandId??null])).rows[0].result;
 if(routed.status===200){
  if(token)routed.data={...routed.data,token,displayOnce:true};
  if(op.preview)routed.data={items:op.preview,previewOnly:true,requiresConfirmation:true};
  if(op.action==='config')Object.assign(routed.data,{remoteApiEnabled:config.ownerBookApiEnabled===true,keyPolicy:{maxLifetimeDays:90,singleUseSupported:false},passwordManager:{provider:'Bitwarden',url:'https://vault.bitwarden.eu/',connected:false},financialIntegration:'not_connected'});
 }
 return routed;
}
export async function routeBookToken({req,url,sessionPool,body,clientHash}){
 const requestId=randomUUID(),match=/^Bearer ((?:sbob_|sboa_|sbor_|sbocc_|sbocs_)[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');
 const digest=createHash('sha256').update(match?.[1]||'').digest('hex');
 const call=async(op,explicit=false,commandId=null)=>(await sessionPool.query('SELECT owner_book.token_rpc($1,$2,$3,$4::jsonb,$5::uuid,$6::boolean,$7,$8::uuid) AS result',[digest,op.action,op.kind,JSON.stringify(op.p),commandId,explicit,clientHash,requestId])).rows[0].result;
 try{
  if(req.headers.cookie||req.headers.origin)throw new ApiError(403,'BOOK_MACHINE_ONLY','Use scoped server-to-server authentication, without browser cookies.');
  let input=['GET','HEAD'].includes(req.method)?{}:await body(req),operationUrl=url,assistant=false;
  const assistantPath=url.pathname.slice('/api/integrations/owner-book/v1'.length);
  if(assistantPath.startsWith('/assistant/')){
   if(!(req.method==='POST'&&assistantPath==='/assistant/entries'||req.method==='PUT'&&/^\/assistant\/entries\/[a-f0-9-]+$/i.test(assistantPath)))throw new ApiError(404,'BOOK_NOT_FOUND','Assistant operation not found.');
   object(input,['entry','requestKey','explicitWrite'],['entry','requestKey','explicitWrite']);
   if(input.explicitWrite!==true)throw new ApiError(403,'BOOK_EXPLICIT_WRITE_REQUIRED','An explicit confirmed OWNER command is required.');
   if(!['task','note','idea','event'].includes(input.entry?.kind))throw new ApiError(403,'BOOK_SCOPE_DENIED','The assistant can write only tasks, notes, ideas and events.');
   assistant=true;input={entry:input.entry,requestKey:input.requestKey};operationUrl=new URL(url);operationUrl.pathname=operationUrl.pathname.replace('/v1/assistant/','/v1/');
  }
  const op=bookOperation(operationUrl,req.method,input,'/api/integrations/owner-book/v1');
  if(!['list','get','history','save','journal','import','export'].includes(op.action))throw new ApiError(403,'BOOK_SCOPE_DENIED','This API cannot manage keys, account security, CRM or passwords.');
  const write=['save','import'].includes(op.action),commandId=write?commandUuid(assistant?input.requestKey:req.headers['x-shadowbridge-command-id']):null;
  if(write&&op.commandId!==commandId)invalid('Use one matching command UUID in the body and header.');
  const result=await call(op,assistant||req.headers['x-shadowbridge-explicit-write']==='true',commandId);
  return redactBookJournal(result,op.action);
 }catch(error){
  let audit;try{audit=await call({action:'invalid',kind:null,p:{}});}catch{throw new ApiError(503,'BOOK_API_UNAVAILABLE','The private book service is unavailable.');}
  if(audit.status===401||audit.status===429)return audit;
  if(error.status)throw error;
  throw new ApiError(503,'BOOK_API_UNAVAILABLE','The private book service could not complete the operation.');
 }
}

export function redactBookJournal(result,action){
  if(action==='journal'&&result.status===200){
   const d=result.data;
   // Delegated journal.read is not a CRM/security-record grant. Preserve page
   // counts while withholding private event IDs, actions and CRM aggregates.
   result.data={items:d.items.map(e=>e.source==='owner_book.history'?{at:e.at,action:e.action,source:e.source,sourceRef:e.sourceRef,certainty:e.certainty}:{at:e.at,action:'platform.activity_recorded',source:'redacted_platform_metadata',sourceRef:'Details available only in the OWNER interface',certainty:'recorded'}),total:d.total,page:d.page,limit:d.limit,window:d.window,counts:{bookChanges:d.counts.bookChanges,tasksMarkedDone:d.counts.tasksMarkedDone,plannedItems:d.counts.plannedItems},automation:{status:d.automation.status,verifiedAgentRuns:d.automation.verifiedAgentRuns,actualCredits:d.automation.actualCredits,actualMoneyCost:d.automation.actualMoneyCost},coverage:['owner_book.history','redacted_platform_metadata'],warning:'Recorded operational metadata only. Private CRM records, identifiers, counts and security details are withheld. External agents and costs are not connected.'};
  }
 return result;
}
