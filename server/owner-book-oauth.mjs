// OAuth is hosted by the existing app. No provider credentials or new OWNER.
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {ApiError} from './validation.mjs';
import {bookOperation,redactBookJournal} from './owner-book.mjs';
import {createScopes} from './owner-book-append.mjs';
import {writeScopes} from './owner-book-write.mjs';

export const oauthResource='https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp';
export const oauthIssuer='https://shadow-bridge.eu';
export const oauthPrefix='/oauth/owner-book';
export const oauthScopes=Object.freeze(['note.read','task.read','idea.read','event.read','decision.read','journal.read']);
export const oauthRedirects=Object.freeze(['https://chatgpt.com/connector_platform_oauth_redirect','https://platform.openai.com/apps-manage/oauth']);
export const oauthChallenge=`Bearer resource_metadata="${oauthIssuer}/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp", scope="note.read"`;
export const digest=s=>createHash('sha256').update(s).digest('hex');
const opaque=prefix=>prefix+randomBytes(32).toString('base64url');
const fail=(message='Invalid OAuth request.',status=400)=>{throw new ApiError(status,'OAUTH_REQUEST_REJECTED',message);};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&a.length>0&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function fields(p,allowed){const result={};for(const [k,v]of p){if(!allowed.includes(k))continue;if(p.getAll(k).length!==1)fail();result[k]=v;}return result;}
async function form(req){
 if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))fail('Use a form-encoded token request.',415);
 let value='';for await(const part of req){value+=part.toString();if(Buffer.byteLength(value)>8192)fail('Request too large.',413);}return new URLSearchParams(value);
}
export function authorizationParameters(search,{createEnabled=false,writeEnabled=false}={}){
 const p=fields(search,['response_type','client_id','redirect_uri','scope','state','code_challenge','code_challenge_method','resource']);
 if(p.response_type!=='code'||!/^sboc_[a-f0-9-]{36}$/.test(p.client_id||'')||!oauthRedirects.includes(p.redirect_uri)||
  p.resource!==oauthResource||p.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge||'')||
  typeof p.state!=='string'||p.state.length<16||p.state.length>1024)fail('Use authorization_code, PKCE S256, an exact registered ChatGPT callback and the MCP resource.');
 const scopes=(p.scope||'note.read').split(' ');
 if(!scopes.length||scopes.length>16||!scopes.includes('note.read')||new Set(scopes).size!==scopes.length||scopes.some(s=>![...oauthScopes,...(createEnabled?createScopes:[]),...(writeEnabled?writeScopes:[])].includes(s)))fail('Only explicitly enabled Book scopes are allowed.');
 if(scopes.some(s=>s.endsWith('.create'))&&scopes.some(s=>s.endsWith('.write')))fail('Temporary import and normal write consent must remain separate.');
 for(const scope of scopes.filter(s=>s.endsWith('.create')||s.endsWith('.write')))if(!scopes.includes(scope.replace(/\.(create|write)$/,'.read')))fail('A matching read scope is required.');
 return {...p,scopes};
}
export function oauthMetadata(pathname,{createEnabled=false,writeEnabled=false}={}){
 // Discovery selects one consent class. Keep explicit legacy import requests
 // valid, but never invite clients to combine .create with normal .write.
 const supported=[...oauthScopes,...(writeEnabled?writeScopes:createEnabled?createScopes:[])];
 if(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp'].includes(pathname))return {resource:oauthResource,authorization_servers:[oauthIssuer],scopes_supported:supported,bearer_methods_supported:['header'],resource_name:writeEnabled?'ShadowBridge OWNER Book with scoped write consent':'ShadowBridge OWNER Book read-only'};
 if(pathname==='/.well-known/oauth-authorization-server')return {issuer:oauthIssuer,authorization_endpoint:oauthIssuer+oauthPrefix+'/authorize',token_endpoint:oauthIssuer+oauthPrefix+'/token',registration_endpoint:oauthIssuer+oauthPrefix+'/register',revocation_endpoint:oauthIssuer+oauthPrefix+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],code_challenge_methods_supported:['S256'],scopes_supported:supported,authorization_response_iss_parameter_supported:true};
 return null;
}
const cookieName=secure=>secure?'__Host-sb_book_oauth':'sb_book_oauth';
const cookieValue=(req,secure)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName(secure)+'='))?.split('=')[1]||'';
export function sealConsent(p,key){const data=Buffer.from(JSON.stringify(p)).toString('base64url');return data+'.'+createHmac('sha256',key).update('book-oauth-consent:'+data).digest('base64url');}
export function openConsent(token,key,nonce){
 if(typeof token!=='string'||token.length>6000||!/^[A-Za-z0-9_-]{43}$/.test(nonce))fail('Restart the connection.',403);
 const [data,signature,...extra]=token.split('.');
 if(extra.length||!equal(signature,createHmac('sha256',key).update('book-oauth-consent:'+data).digest('base64url')))fail('Restart the connection.',403);
 let p;try{p=JSON.parse(Buffer.from(data,'base64url'));}catch{fail();}
 if(!p||!Number.isSafeInteger(p.expires)||p.expires<Date.now()||p.expires>Date.now()+301000||!equal(p.nonce_hash,digest(nonce)))fail('Consent expired or belongs to another browser.',403);
 return p;
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function consentHtml(name,scopes,ticket=''){
 const temporary=scopes.some(s=>s.endsWith('.create'));
 const write=scopes.some(s=>s.endsWith('.write'));
 const notice=write?'<label><input id="oauth-write-consent" type="checkbox"> I separately authorize creating and editing single Book entries only in the listed scopes, on my explicit instructions. No deletion, bulk import, journal edits, CRM, keys or secrets. This connection expires within seven days and can be revoked immediately.</label>':temporary?'<label><input id="oauth-create-consent" type="checkbox"> I separately authorize temporary additions only: at most 25 new Book entries within 60 minutes. Each import needs a reviewed preview, fresh OWNER MFA approval and verified backup. No editing, deletion, CRM or secrets.</label>':'';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ShadowBridge | Private OAuth consent</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/entry.css"><script src="/assets/owner-book-oauth.js" defer></script><body class="entry-page"><main class="entry-shell"><section class="entry-panel"><p class="eyebrow">OWNER BOOK · PRIVATE CONNECTION</p><h1>'+ (write?'Create and edit Book entries':temporary?'Temporary additions':'Read-only access') +'</h1><p>Application: <strong>'+escape(name)+'</strong></p><p>Requested permissions: '+escape(scopes.join(', '))+'</p><p>Existing OWNER, verified email and fresh MFA are required. No account changes, CRM, passwords or deletions are authorized. Record edits require the separately listed write scopes.</p>'+notice+'<p><a href="/member-sign-in/" target="_blank" rel="noopener">Sign in with your existing account in a new tab</a> · <a href="/portal/admin/" target="_blank" rel="noopener">Confirm OWNER MFA</a></p><p>After signing in and confirming MFA, return here and choose Check access. Never enter a key in ChatGPT.</p><p id="oauth-status" role="status" aria-live="polite">Checking access…</p><input id="oauth-ticket" type="hidden" value="'+escape(ticket)+'"><button id="oauth-check" type="button">Check access</button> <button id="oauth-approve" type="button" disabled>' + (write?'Allow the listed Book writes':temporary?'Allow temporary additions':'Allow read-only access') + '</button> <button id="oauth-deny" type="button">Cancel</button><section id="oauth-connections" aria-label="Existing connections"></section><p><a href="/portal/admin/?module=book">Back to Command Book</a></p></section></main></body></html>';
}
export async function routeOAuth({req,res,url,config,db,auth,body,clientHash,limit}){
 const meta=oauthMetadata(url.pathname,{createEnabled:config.ownerBookMcpCreateEnabled,writeEnabled:config.ownerBookMcpWriteEnabled});
 if(!meta&&!url.pathname.startsWith(oauthPrefix+'/'))return false;
 if(!config.ownerBookApiEnabled||!config.ownerBookMcpEnabled||!config.ownerBookOAuthEnabled)throw new ApiError(503,'BOOK_OAUTH_DISABLED','OAuth has not been activated.');
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache'});res.end(JSON.stringify(data));return true;};
 const html=data=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);return true;};
 const machine=async(action,p)=>{const r=(await db.sessionPool.query('SELECT owner_book.oauth_machine($1,$2::jsonb,$3,$4::uuid) AS result',[action,JSON.stringify(p),clientHash,randomUUID()])).rows[0].result;return r;};
 const owner=async(action,p={},review=false)=>{
  const identity=await auth.authenticate(req);
  if(!identity||identity.recoveryOnly||identity.aal!=='aal2'||!identity.emailVerified)return {status:403,data:{code:'OWNER_MFA_REQUIRED'}};
  return db.asUser(identity,{aal:identity.aal},async tx=>(await tx.query('SELECT owner_book.'+(review?'append_owner':'oauth_owner')+'($1,$2::jsonb,$3::uuid) AS result',[action,JSON.stringify(p),randomUUID()])).rows[0].result);
 };
 if(meta){if(req.method!=='GET')return json(405,{error:'invalid_request'});return json(200,meta);}
 limit(req,'book-oauth', '',120);
 const path=url.pathname.slice(oauthPrefix.length);
 if(path==='/register'&&req.method==='POST'){
  if(req.headers.cookie||req.headers.origin)return json(403,{error:'invalid_request'});
  const p=await body(req);
  // RFC 7591: ignore unknown metadata, never fetch metadata/logo URLs. Validate
  // every field that can change authentication, scope, grants or callbacks.
  if(!p||Array.isArray(p)||typeof p!=='object'||!Array.isArray(p.redirect_uris)||p.redirect_uris.length<1||p.redirect_uris.length>2||new Set(p.redirect_uris).size!==p.redirect_uris.length||p.redirect_uris.some(x=>!oauthRedirects.includes(x)))return json(400,{error:'invalid_redirect_uri'});
  const method=p.token_endpoint_auth_method??'client_secret_basic';
  if(!['none','client_secret_post','client_secret_basic'].includes(method)||p.grant_types!==undefined&&(!Array.isArray(p.grant_types)||!p.grant_types.includes('authorization_code')||p.grant_types.some(g=>!['authorization_code','refresh_token'].includes(g)))||p.response_types!==undefined&&JSON.stringify(p.response_types)!=='["code"]'||p.scope!==undefined&&(typeof p.scope!=='string'||p.scope.split(' ').some(s=>![...oauthScopes,...(config.ownerBookMcpCreateEnabled?createScopes:[]),...(config.ownerBookMcpWriteEnabled?writeScopes:[])].includes(s))))return json(400,{error:'invalid_client_metadata'});
  const id='sboc_'+randomUUID(),secret=method==='none'?null:opaque('sbocs_'),name=typeof p.client_name==='string'?p.client_name.trim(): 'ChatGPT';
  if(name.length<1||name.length>80)return json(400,{error:'invalid_client_metadata'});
  const r=await machine('register',{id,name,redirects:p.redirect_uris,auth_method:method,secret_hash:secret?digest(secret):null});
  if(r.status!==200)return json(r.status,r.data);
  return json(201,{client_id:id,...(secret?{client_secret:secret,client_secret_expires_at:Math.floor(Date.now()/1000)+2592000}:{}),client_id_issued_at:Math.floor(Date.now()/1000),redirect_uris:p.redirect_uris,token_endpoint_auth_method:method,grant_types:['authorization_code','refresh_token'],response_types:['code']});
 }
 if(path==='/authorize'&&req.method==='GET'){
  const p=authorizationParameters(url.searchParams,{createEnabled:config.ownerBookMcpCreateEnabled,writeEnabled:config.ownerBookMcpWriteEnabled}),client=await machine('client',{client_id:p.client_id});
  if(client.status!==200||!client.data.redirects.includes(p.redirect_uri))return json(400,{error:'invalid_client'});
  const nonce=opaque(''),ticket=sealConsent({...p,nonce_hash:digest(nonce),expires:Date.now()+300000},config.sessionEncryptionKey);
  const previous=res.getHeader('Set-Cookie')||[];
  res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:[previous]),cookieName(config.secureCookies)+'='+nonce+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=300'+(config.secureCookies?'; Secure':'')]);
  return html(consentHtml(client.data.name,p.scopes,ticket));
 }
 if(path==='/connections'&&req.method==='GET')return html(consentHtml('Manage existing connections',[]));
 const reviewMatch=path.match(/^\/imports\/([a-f0-9-]{36})(?:\/(data|approve))?$/);
 if(reviewMatch){
  const id=reviewMatch[1],action=reviewMatch[2];
  if(!action&&req.method==='GET')return html('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OWNER import review</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/owner-book.css"><link rel="stylesheet" href="/assets/entry.css"><script src="/assets/owner-book-import-review.js" defer></script><body class="entry-page"><main class="entry-shell"><section class="entry-panel"><h1>Review proposed additions</h1><p>No existing entry will be deleted or overwritten. Compare sources and completed work before approving.</p><p><a href="/portal/admin/" target="_blank" rel="noopener">Confirm existing OWNER MFA</a></p><p id="import-status" role="status" aria-live="polite">Loading authorized preview…</p><div id="import-preview"></div><label><input id="import-confirm" type="checkbox"> I approve only the missing entries displayed here, preserving all existing records.</label><button id="import-approve" type="button" disabled>Approve this exact preview</button><p>Approval alone does not import. The operator must verify an encrypted backup made after approval. Then the prepared import can be applied and read back.</p><p><a href="/oauth/owner-book/connections">Manage or withdraw temporary create access</a></p></section></main></body></html>');
  if(action==='data'&&req.method==='GET'){const r=await owner('read',{id},true);return json(r.status,r.status===200?{...r.data,...auth.csrf(req,res)}:r.data);}
  if(action==='approve'&&req.method==='POST'){
   if(!config.ownerBookMcpCreateEnabled)return json(503,{code:'BOOK_MCP_CREATE_DISABLED'});
   auth.enforceSession(req);auth.enforceCSRF(req);const p=await body(req);
   if(!p||Object.keys(p).some(k=>!['candidateHash','snapshotHash','confirm'].includes(k))||p.confirm!==true)return json(400,{code:'APPEND_EXPLICIT_APPROVAL_REQUIRED'});
   const r=await owner('approve',{...p,id},true);return json(r.status,r.data);
  }
  return json(405,{error:'invalid_request'});
 }
 if(path==='/context'&&req.method==='GET'){
  const r=await owner('context');if(r.status!==200)return json(r.status,r.data);
  const connections=await owner('connections');return json(connections.status,{...connections.data,...auth.csrf(req,res)});
 }
 if(['/consent','/connections/revoke','/connections/revoke-create','/connections/revoke-write'].includes(path)&&req.method==='POST'){
  auth.enforceSession(req);auth.enforceCSRF(req);const input=await body(req);
  if(['/connections/revoke','/connections/revoke-create','/connections/revoke-write'].includes(path)){
   if(!input||Object.keys(input).some(k=>k!=='id')||!/^[a-f0-9-]{36}$/.test(input.id||''))fail();
   const r=await owner(path.endsWith('revoke-create')?'revoke_create':path.endsWith('revoke-write')?'revoke_write':'revoke',{id:input.id});return json(r.status,r.data);
  }
  if(!input||Object.keys(input).some(k=>!['ticket','approve','temporaryCreateConsent','explicitWriteConsent'].includes(k))||typeof input.approve!=='boolean')fail();
  const p=openConsent(input.ticket,config.sessionEncryptionKey,cookieValue(req,config.secureCookies));
  const temporary=p.scopes.some(s=>s.endsWith('.create'));if(input.approve&&temporary&&(!config.ownerBookMcpCreateEnabled||input.temporaryCreateConsent!==true))return json(403,{code:'APPEND_SEPARATE_CONSENT_REQUIRED'});
  const write=p.scopes.some(s=>s.endsWith('.write'));if(input.approve&&write&&(!config.ownerBookMcpWriteEnabled||input.explicitWriteConsent!==true))return json(403,{code:'BOOK_WRITE_SEPARATE_CONSENT_REQUIRED'});
  const check=await owner('context');if(check.status!==200)return json(check.status,check.data);
  const redirect=new URL(p.redirect_uri);redirect.searchParams.set('state',p.state);redirect.searchParams.set('iss',oauthIssuer);
  if(!input.approve)redirect.searchParams.set('error','access_denied');
  else{
   const code=opaque('sbocc_'),r=await owner('authorize',{client_id:p.client_id,redirect_uri:p.redirect_uri,scopes:p.scopes,challenge:p.code_challenge,resource:p.resource,flow_hash:p.nonce_hash,code_hash:digest(code),...(temporary?{temporaryCreateConsent:true}:{}),...(write?{explicitWriteConsent:true}:{})});
   if(r.status!==200)return json(r.status,r.data);redirect.searchParams.set('code',code);
  }
  return json(200,{redirect:redirect.href});
 }
 if(['/token','/revoke'].includes(path)&&req.method==='POST'){
  if(req.headers.cookie||req.headers.origin)return json(403,{error:'invalid_request'});
  const p=fields(await form(req),['grant_type','code','redirect_uri','code_verifier','resource','client_id','client_secret','refresh_token','scope','token','token_type_hint']);
  let method='none',secret=null;
  if(req.headers.authorization){
   if(p.client_secret!==undefined||!/^Basic [A-Za-z0-9+/]+=*$/.test(req.headers.authorization))return json(401,{error:'invalid_client'});
   const raw=Buffer.from(req.headers.authorization.slice(6),'base64').toString(),i=raw.indexOf(':');if(i<1)return json(401,{error:'invalid_client'});
   const id=decodeURIComponent(raw.slice(0,i));if(p.client_id!==undefined&&p.client_id!==id)return json(401,{error:'invalid_client'});p.client_id=id;secret=decodeURIComponent(raw.slice(i+1));method='client_secret_basic';
  }else if(p.client_secret!==undefined){secret=p.client_secret;method='client_secret_post';}
  const base={client_id:p.client_id,auth_method:method,secret_hash:secret?digest(secret):null};
  if(!/^sboc_[a-f0-9-]{36}$/.test(p.client_id||''))return json(401,{error:'invalid_client'});
  if(path==='/revoke'){
   const r=await machine('revoke',{...base,token_hash:digest(p.token||'')});return json(r.status,r.data);
  }
  if(p.resource!==oauthResource||p.scope!==undefined)return json(400,{error:p.scope!==undefined?'invalid_scope':'invalid_target'});
  const access=opaque('sboa_'),refresh=opaque('sbor_');let action,payload;
  if(p.grant_type==='authorization_code'){
   if(!/^sbocc_[A-Za-z0-9_-]{43}$/.test(p.code||'')||!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier||'')||!oauthRedirects.includes(p.redirect_uri))return json(400,{error:'invalid_grant'});
   action='token';payload={code_hash:digest(p.code),redirect_uri:p.redirect_uri,challenge:createHash('sha256').update(p.code_verifier).digest('base64url')};
  }else if(p.grant_type==='refresh_token'){
   if(!/^sbor_[A-Za-z0-9_-]{43}$/.test(p.refresh_token||''))return json(400,{error:'invalid_grant'});
   action='refresh';payload={refresh_hash:digest(p.refresh_token)};
  }else return json(400,{error:'unsupported_grant_type'});
  const r=await machine(action,{...base,...payload,resource:p.resource,access_hash:digest(access),next_refresh_hash:digest(refresh)});
  return json(r.status,r.status===200?{...r.data,token_type:'Bearer',access_token:access,refresh_token:refresh}:r.data);
 }
 return json(404,{error:'invalid_request'});
}
export async function routeOAuthBookRead({req,url,sessionPool,clientHash}){
 const match=/^Bearer (sboa_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');
 if(!match)return {status:401,data:{code:'BOOK_API_DENIED'}};
 const op=bookOperation(url,'GET',{},'/api/integrations/owner-book/v1');
 if(!['list','get','journal'].includes(op.action))return {status:403,data:{code:'BOOK_SCOPE_DENIED'}};
 const result=(await sessionPool.query('SELECT owner_book.oauth_machine($1,$2::jsonb,$3,$4::uuid) AS result',['read',JSON.stringify({token_hash:digest(match[1]),resource:oauthResource,action:op.action,kind:op.kind,params:op.p}),clientHash,randomUUID()])).rows[0].result;
 return redactBookJournal(result,op.action);
}
