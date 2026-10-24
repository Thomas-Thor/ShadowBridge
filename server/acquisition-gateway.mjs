// Disabled unless an explicit private configuration is supplied at startup.
// No OWNER session, provider credit purchase, or provider request happens here.
import {createHash,timingSafeEqual} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {ApiError,object,identifier,oneOf} from './validation.mjs';
import {vaultIntake} from './owner-vault.mjs';

const fields=v=>{if(!Array.isArray(v)||!v.length||v.length>5||v.some(x=>!['workEmail','title','professionalUrl','website','sector'].includes(x)))throw new ApiError(400,'INVALID_INPUT','Select supported required fields.');return [...new Set(v)].sort();};
const companySource=v=>{if(typeof v!=='string'||!v.length||v.length>200)throw new ApiError(400,'INVALID_INPUT','Stable company source ID required.');return v;};
function record(v){
 if(v?.contact)return vaultIntake(v);
 object(v,['company','source'],['company','source']);
 const checked=vaultIntake({...v,contact:{fullName:'validation only'}});delete checked.contact;return checked;
}
export function createAcquisitionGateway({principals,queryFactory}){
 if(!Array.isArray(principals)||!principals.length||principals.length>3)throw Error('Explicit acquisition principals required');
 const keys=new Set(),providers=new Set();
 for(const p of principals){
  if(!['apollo','clay','relevance'].includes(p.provider)||!/^[a-f0-9]{64}$/.test(p.tokenSha256||'')||keys.has(p.tokenSha256)||providers.has(p.provider))throw Error('Distinct hashed per-provider machine keys required');keys.add(p.tokenSha256);providers.add(p.provider);
 }
 const counts=new Map();
 return {async handle(req,url,body){
  if(req.method!=='POST'||url.search||req.headers.cookie||req.headers.origin)throw new ApiError(403,'MACHINE_ONLY','Use the scoped server-to-server gateway.');
  const token=/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers.authorization||'')?.[1];
  const digest=createHash('sha256').update(token||'').digest();let principal;
  for(const p of principals)if(timingSafeEqual(Buffer.from(p.tokenSha256,'hex'),digest))principal=p;
  if(!token||!principal)throw new ApiError(401,'MACHINE_AUTH_REQUIRED','Valid scoped machine authorization required.');
  const bucket=Math.floor(Date.now()/300000),key=principal.provider+':'+bucket;
  counts.set(key,(counts.get(key)||0)+1);if(counts.get(key)>300)throw new ApiError(429,'RATE_LIMITED','Acquisition gateway limit reached.');
  for(const k of counts.keys())if(!k.endsWith(':'+bucket))counts.delete(k);
  const action=url.pathname.split('/').at(-1),input=await body(req);let sql,args;
  if(action==='check'||action==='intake'||action==='reserve'||action==='finish'){
   object(input,['record','companySourceId','requiredFields','requestKey','operation','reservation'],['record','companySourceId']);
   const p=record(input.record);if(p.source.system!==principal.provider)throw new ApiError(403,'SOURCE_SCOPE','Source does not match the machine principal.');
   const co=companySource(input.companySourceId);
   if(action==='check'){sql='SELECT acquisition_guard.check_record($1::jsonb,$2,$3::text[]) AS result';args=[JSON.stringify(p),co,fields(input.requiredFields)];}
   if(action==='intake'){sql='SELECT acquisition_guard.save_record($1::jsonb,$2,$3::uuid) AS result';args=[JSON.stringify(p),co,identifier(input.requestKey)];}
   if(action==='reserve'){sql='SELECT acquisition_guard.reserve($1::jsonb,$2,$3::text[],$4::uuid,$5) AS result';args=[JSON.stringify(p),co,fields(input.requiredFields),identifier(input.requestKey),oneOf(input.operation,['email_reveal','enrichment'],'operation')];}
   if(action==='finish'){sql='SELECT acquisition_guard.finish($1::uuid,$2::jsonb,$3,$4::uuid) AS result';args=[identifier(input.reservation),JSON.stringify(p),co,identifier(input.requestKey)];}
  }else if(action==='dispatch'||action==='uncertain'){
   object(input,['reservation'],['reservation']);sql=action==='dispatch'?'SELECT acquisition_guard.dispatch($1::uuid) AS result':'SELECT acquisition_guard.uncertain($1::uuid) AS result';args=[identifier(input.reservation)];
  }else if(action==='usage'){
   object(input,[],[]);sql='SELECT acquisition_guard.usage() AS result';args=[];
  }else if(action==='search'){
   object(input,['filters','cursor','lease','exhausted'],['filters']);sql='SELECT acquisition_guard.search_page($1::jsonb,$2::jsonb,$3::uuid,$4::boolean) AS result';args=[JSON.stringify(input.filters),input.cursor===undefined?null:JSON.stringify(input.cursor),input.lease?identifier(input.lease):null,input.exhausted===true];
  }else throw new ApiError(404,'NOT_FOUND','Acquisition operation not found.');
  try{return {status:200,data:(await queryFactory(principal).query(sql,args)).rows[0]?.result??{recorded:true}};}
  catch(e){if(e.code==='42501')throw new ApiError(403,'ACQUISITION_DENIED','The acquisition binding is disabled or not authorized.');if(e.code==='54000')throw new ApiError(429,'RATE_LIMITED','CRM intake limit reached.');if(['22023','23505'].includes(e.code))throw new ApiError(409,'CRM_REVIEW_REQUIRED','Review conflicting identity or retry information.');throw new ApiError(503,'CRM_UNAVAILABLE','CRM check unavailable. Paid operations must stop.');}
 },close:async()=>{}};
}
export function assertRestrictedAcquisitionRole(meta,provider){
 const forbidden=['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication','executor','api','sessions','policy'];
 if(!meta||forbidden.some(k=>meta[k]!==false)||meta.ingest!==true||meta.provider!==provider)throw Error('Dedicated non-privileged source binding required');
}
export async function loadAcquisitionGateway({file,production=true}={}){
 if(!file)return null;
 const pools=new Map();
 try{
  const info=await lstat(file);if(!info.isFile()||(info.mode&0o077)||info.size>65536)throw Error('Private regular file required');
  const config=JSON.parse(await readFile(file,'utf8'));if(config.enabled!==true)return null;
  const gateway=createAcquisitionGateway({principals:config.principals,queryFactory:p=>pools.get(p.provider)});
  for(const p of config.principals){
   const u=new URL(p.databaseUrl);if(!['postgres:','postgresql:'].includes(u.protocol)||!/^shadowbridge_acquisition_gateway_[a-z0-9_]+$/.test(decodeURIComponent(u.username))||u.password.length<24||(production&&u.searchParams.get('sslmode')!=='verify-full'))throw Error('Restricted login and verified TLS required');
  }
  const {default:pg}=await import('pg');
  for(const p of config.principals){
   const pool=new pg.Pool({connectionString:p.databaseUrl,max:2,statement_timeout:15000,application_name:'shadowbridge-acquisition-guard'});pools.set(p.provider,pool);
   const row=(await pool.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,pg_has_role(session_user,'shadowbridge_vault_executor','member') AS executor,pg_has_role(session_user,'shadowbridge_api','member') AS api,pg_has_role(session_user,'shadowbridge_sessions','member') AS sessions,pg_has_role(session_user,'shadowbridge_policy','member') AS policy,pg_has_role(session_user,'shadowbridge_vault_ingest','member') AS ingest FROM pg_roles WHERE rolname=session_user")).rows[0];
   assertRestrictedAcquisitionRole({...row,provider:p.provider},p.provider);
   const usage=(await pool.query('SELECT acquisition_guard.usage() AS data')).rows[0]?.data;
   assertRestrictedAcquisitionRole({...row,provider:usage?.provider},p.provider);
  }
  gateway.close=async()=>Promise.all([...pools.values()].map(p=>p.end()));return gateway;
 }catch{
  await Promise.allSettled([...pools.values()].map(p=>p.end()));throw Error('Acquisition gateway configuration or database binding rejected; private values omitted');
 }
}
