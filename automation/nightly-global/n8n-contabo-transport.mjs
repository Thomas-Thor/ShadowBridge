// Authenticated operator transport. No tunnels, sudo, DB access, secrets on disk
// or fallback around API authorization. The SAME n8n API key reaches n8n.
import {execFile,execFileSync} from 'node:child_process';
import {mkdtemp,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
const must=(v,c)=>{if(!v)throw Error(c);};

// Serialized as fixed source in SSH's remote command. Request/secret only on
// encrypted stdin, never remote argv, ENV, shell text or files.
export async function remoteN8nHttp({origin='internal',method='GET',route,headers={},body}){
 const must=(v,c)=>{if(!v)throw Error(c);};
 must(['internal','public'].includes(origin),'REMOTE_ORIGIN_INVALID');
 const get=method==='GET'&&(/^(?:\/healthz|\/api\/v1\/credentials(?:\?limit=100(?:&cursor=[A-Za-z0-9%_.~-]+)?|\/schema\/httpHeaderAuth|\/[A-Za-z0-9_-]{1,100})|\/api\/v1\/workflows(?:\?limit=(?:1|100)(?:&(?:projectId|cursor)=[A-Za-z0-9%_.~-]+)*|\/[A-Za-z0-9_-]{1,100}))$/.test(route||''));
 const post=method==='POST'&&/^(?:\/api\/v1\/(?:credentials|workflows)|\/api\/v1\/workflows\/[A-Za-z0-9_-]{1,100}\/activate|\/webhook\/shadowbridge-global-b2b-sourcing-v1-canary)$/.test(route||'');
 must(get||post,'REMOTE_ROUTE_BLOCKED');must(Object.keys(headers).every(k=>['Accept','Content-Type','X-N8N-API-KEY','Authorization'].includes(k)),'REMOTE_HEADERS_BLOCKED');
 must(Object.values(headers).every(v=>typeof v==='string'&&!/[\r\n]/.test(v)),'REMOTE_HEADERS_INVALID');
 const payload=body===undefined?undefined:JSON.stringify(body);must(!payload||Buffer.byteLength(payload)<=1048576,'REMOTE_PAYLOAD_TOO_LARGE');
 const client=await import(origin==='internal'?'node:http':'node:https'),{createHash}=await import('node:crypto');
 return new Promise(resolve=>{
  let settled=false;const done=r=>{if(!settled){settled=true;resolve(r);}};
  const req=client.request({hostname:origin==='internal'?'127.0.0.1':'automation.shadow-bridge.eu',port:origin==='internal'?5678:443,path:route,method,headers:{Accept:'application/json',...headers,...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})},rejectUnauthorized:true},res=>{
   const chunks=[];let bytes=0;
   res.on('data',b=>{bytes+=b.length;if(bytes>8388608){req.destroy();done({transportError:'RESPONSE_TOO_LARGE'});}else chunks.push(b);});
   res.on('error',()=>done({transportError:'RESPONSE_INTERRUPTED'}));
   res.on('end',()=>{if(settled)return;const text=Buffer.concat(chunks).toString();let data=null;try{data=JSON.parse(text);}catch{}
    done({status:res.statusCode,contentType:String(res.headers['content-type']||'').split(';')[0].slice(0,80),serverHint:/cloudflare/i.test(res.headers.server||'')?'cloudflare':/caddy/i.test(res.headers.server||'')?'caddy':/nginx/i.test(res.headers.server||'')?'nginx':'unidentified',viaPresent:!!res.headers.via,cfRayPresent:!!res.headers['cf-ray'],data,bodyKind:data!==null?'json':/^\s*</.test(text)?'html':'text',...(res.statusCode>=400?{errorDigest:createHash('sha256').update(text).digest('hex')}:{})});
   });
  });
  req.setTimeout(12000,()=>req.destroy(Object.assign(Error(),{code:'ETIMEDOUT'})));
  req.on('error',e=>done({transportError:['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(e.code)?e.code:'REMOTE_CONNECTION_FAILED'}));
  if(payload)req.write(payload);req.end();
 });
}
export function safeApiEvidence(response){
 if(response.transportError)return{transportError:response.transportError};
 const d=response.data,raw=typeof d?.message==='string'?d.message:typeof d?.error==='string'?d.error:typeof d?.error?.message==='string'?d.error.message:'';
 const errorCategory=/scope/i.test(raw)&&/missing|required|insufficient|not.*allow|permission/i.test(raw)?'REQUIRED_SCOPE_DENIED':/owner|admin/i.test(raw)&&/only|must|require|not|denied/i.test(raw)?'OWNER_ADMIN_RESTRICTION':/licen[sc]e|enterprise|upgrade|plan does not/i.test(raw)?'LICENSE_RESTRICTION':/project/i.test(raw)&&/permission|access|forbidden|denied/i.test(raw)?'PROJECT_PERMISSION_DENIED':/invalid|expired/i.test(raw)&&/api.?key|token/i.test(raw)?'API_KEY_INVALID_OR_EXPIRED':/^forbidden\.?$/i.test(raw.trim())?'GENERIC_FORBIDDEN':/^unauthorized\.?$/i.test(raw.trim())?'GENERIC_UNAUTHORIZED':response.status>=400?'UNCLASSIFIED_DENIAL':'NONE';
 const scopes=['credential:list','credential:read','credential:create','workflow:list','workflow:read','workflow:create','workflow:activate'];
 const code=d?.code??d?.error?.code,safeCode=[400,401,403,404,'FORBIDDEN','UNAUTHORIZED','INSUFFICIENT_SCOPE','INSUFFICIENT_PERMISSIONS','FEATURE_NOT_LICENSED','ACCESS_DENIED','INVALID_API_KEY'].includes(code)?code:null;
 return{status:response.status,bodyKind:response.bodyKind,contentType:response.contentType,serverHint:response.serverHint,viaPresent:response.viaPresent,cfRayPresent:response.cfRayPresent,errorCategory,apiErrorCode:safeCode,errorMentionsScopes:scopes.filter(s=>raw.includes(s)),...(response.errorDigest?{errorDigest:response.errorDigest}:{}),...(/^(Forbidden|Unauthorized)\.?$/i.test(raw.trim())?{message:raw.trim()}:{}),rawBodyDisclosed:false};
}
export async function diagnoseN8nAccess({request,key,projectId,googleId}){
 must(typeof key==='string'&&key.length>0&&!/[\r\n]/.test(key),'EXISTING_N8N_KEY_REQUIRED');
 must([projectId,googleId].every(v=>/^[A-Za-z0-9_-]{1,100}$/.test(v||'')),'ACCESS_BINDINGS_INVALID');
 const routes={health:'/healthz',workflows:'/api/v1/workflows?limit=1&projectId='+projectId,credentialList:'/api/v1/credentials?limit=100',selectedCredential:'/api/v1/credentials/'+googleId};
 const results={};
 for(const origin of ['internal','public']){
  results[origin]={};
  for(const [name,route]of Object.entries(routes))results[origin][name]=await request({origin,method:'GET',route,headers:name==='health'?{}:{'X-N8N-API-KEY':key}});
 }
 const native=results.internal,edge=results.public;
 const nativeHealthy=native.health.status===200;
 let selected=null,shared=false,projectProven=false;
 if(native.credentialList.status===200&&Array.isArray(native.credentialList.data?.data)){
  const matches=native.credentialList.data.data.filter(c=>c.id===googleId);
  if(matches.length===1&&!Object.hasOwn(matches[0],'data')){const c=matches[0];selected={id:c.id,name:c.name,type:c.type};projectProven=Array.isArray(c.shared);shared=c.shared?.some(s=>s.id===projectId)===true;}
 }
 const direct=native.selectedCredential;
 if(!selected&&direct.status===200&&direct.data?.id===googleId&&!Object.hasOwn(direct.data,'data'))selected={id:direct.data.id,name:direct.data.name,type:direct.data.type};
 const n8nDenied=nativeHealthy&&[native.credentialList,direct,native.workflows].some(r=>r.status===403);
 const edgeOnly=nativeHealthy&&native.credentialList.status===200&&edge.credentialList.status===403;
 const metadataOnlyDenied=nativeHealthy&&native.credentialList.status===403&&direct.status===200&&native.workflows.status===200;
 const canResume=nativeHealthy&&native.workflows.status===200&&selected?.type==='googleSheetsOAuth2Api'&&((native.credentialList.status===200&&projectProven&&shared)||metadataOnlyDenied);
 return{kind:'shadowbridge-n8n-access-evidence',observedAt:new Date().toISOString(),readOnly:true,changesMade:false,authorizationHeader:'X-N8N-API-KEY',sameKeyUsedForBothPaths:true,scopeAuthorizationNotInferredFromRecentUse:true,internalOrigin:'http://127.0.0.1:5678 (Contabo loopback only)',publicOrigin:'https://automation.shadow-bridge.eu',endpoints:routes,evidence:Object.fromEntries(Object.entries(results).map(([o,rs])=>[o,Object.fromEntries(Object.entries(rs).map(([n,r])=>[n,safeApiEvidence(r)]))])),selectedCredential:selected,credentialProjectAccess:projectProven?(shared?'CONFIRMED':'NOT_SHARED_WITH_TARGET'):'UNPROVEN_NATIVE_CREATE_AND_GRAPH_CHECK_REQUIRED',projectWorkflowListAccepted:native.workflows.status===200,diagnosis:metadataOnlyDenied?'GLOBAL_LIST_DENIED_TARGET_READ_ALLOWED':canResume?'AUTHENTICATED_INTERNAL_PREFLIGHT_PASS':n8nDenied?'DIRECT_N8N_API_DENIAL_PROVEN':!nativeHealthy?'DIRECT_N8N_HEALTH_NOT_PROVEN':'ACCESS_NOT_PROVEN',publicPathSpecificDenial:edgeOnly,public403Source:edgeOnly?'PUBLIC_PATH_DENIAL_NATIVE_API_ACCEPTS_SAME_KEY':edge.credentialList.status===403?'NOT_ATTRIBUTABLE_FROM_PUBLIC_RESPONSE_ALONE':'NO_PUBLIC_403_OBSERVED',canResumeImport:canResume,providerCalls:0,crmWrites:0,secretsDisclosed:false};
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function readRpcInput(stream){const chunks=[];let size=0;for await(const b of stream){const chunk=Buffer.from(b);size+=chunk.length;if(size>2097152)throw Error('INPUT_TOO_LARGE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export function rpcCommand(){return 'node --input-type=module -e '+quote('try{const input=await ('+readRpcInput.toString()+')(process.stdin);process.stdout.write(JSON.stringify(await ('+remoteN8nHttp.toString()+')(input)));}catch{process.stdout.write(JSON.stringify({transportError:"REMOTE_REQUEST_REJECTED"}));process.exitCode=1;}');}
export async function openContaboTransport(target){
 must(/^[a-z][a-z0-9_-]{0,31}@[A-Za-z0-9.-]{1,253}$/.test(target||''),'AUTHORIZED_SSH_TARGET_REQUIRED');
 const dir=await mkdtemp(path.join(tmpdir(),'sb-n8n-ssh-')),socket=path.join(dir,'cm');
 // Existing SSH authorization. No -L/-R/-D tunnel, no host-key/TLS bypass.
 try{execFileSync('ssh',['-M','-N','-f','-o','ClearAllForwardings=yes','-o','ControlMaster=yes','-o','ControlPersist=120','-o','ControlPath='+socket,target],{stdio:'inherit',timeout:120000});}
 catch{throw Error('AUTHORIZED_OPERATOR_SSH_FAILED');}
 let closed=false;
 return{
  request:input=>new Promise((resolve,reject)=>{
   must(!closed,'OPERATOR_SSH_CLOSED');
   const child=execFile('ssh',['-S',socket,'-o','ClearAllForwardings=yes','-o','BatchMode=yes','-o','ControlMaster=no',target,rpcCommand()],{maxBuffer:12582912,timeout:45000},(error,stdout)=>{
    if(error){reject(Error('OPERATOR_REMOTE_REQUEST_FAILED'));return;}
    try{resolve(JSON.parse(stdout));}catch{reject(Error('OPERATOR_REMOTE_RESPONSE_INVALID'));}
   });child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  }),
  close:async()=>{if(closed)return;closed=true;try{execFileSync('ssh',['-S',socket,'-O','exit',target],{stdio:'ignore',timeout:10000});}catch{}try{await rmdir(dir);}catch{}},
 };
}
export async function remoteJson(request,route,{method='GET',headers={},body}={}){
 const r=await request({origin:'internal',method,route,headers,body});
 if(r.transportError)throw Error('OPERATOR_REMOTE_HTTP_UNAVAILABLE');
 if(r.status===204)return{};
 if(r.status<200||r.status>=300){const e=Error(/^(?:CANARY_|CRM_|GOOGLE_SHEETS_)[A-Z0-9_]{1,110}$/.test(r.data?.reason||'')?r.data.reason:'CANARY_HTTP_'+r.status);e.httpStatus=r.status;throw e;}
 must(r.data&&typeof r.data==='object','OPERATOR_REMOTE_RESPONSE_JSON_REQUIRED');return r.data;
}
