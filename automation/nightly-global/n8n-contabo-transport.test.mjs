import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {remoteN8nHttp,safeApiEvidence,diagnoseN8nAccess,remoteJson,rpcCommand} from './n8n-contabo-transport.mjs';
const config={key:'FICTIONAL_SAME_PRIVATE_API_KEY',projectId:'project1',googleId:'google1'};
const response=(status,data)=>({status,data,bodyKind:'json',contentType:'application/json',serverHint:'unidentified',viaPresent:false,cfRayPresent:false});
function fixture(){const calls=[];return{calls,request:async q=>{calls.push(q);if(q.route==='/healthz')return response(200,{status:'ok'});if(q.route.startsWith('/api/v1/workflows?'))return response(200,{data:[]});if(q.route==='/api/v1/credentials/google1')return response(200,{id:'google1',name:'Fictional Google Sheets',type:'googleSheetsOAuth2Api'});return response(200,{data:[{id:'google1',name:'Fictional Google Sheets',type:'googleSheetsOAuth2Api',shared:[{id:'project1'}]}]});}};}
test('same key probes public and direct n8n using GET only and discloses selected metadata, never key or body',async()=>{
 const f=fixture(),r=await diagnoseN8nAccess({...config,request:f.request});assert.equal(r.canResumeImport,true);assert.equal(r.credentialProjectAccess,'CONFIRMED');assert.equal(r.selectedCredential.name,'Fictional Google Sheets');assert.equal(f.calls.length,8);assert.ok(f.calls.every(q=>q.method==='GET'));assert.ok(f.calls.filter(q=>q.route!=='/healthz').every(q=>q.headers['X-N8N-API-KEY']===config.key));assert.ok(!JSON.stringify(r).includes(config.key));
});
test('public HTML 403 does not become a scope error when direct n8n accepts the same key',async()=>{
 const f=fixture(),r=await diagnoseN8nAccess({...config,request:async q=>q.origin==='public'&&q.route.includes('/credentials?')?{...response(403,null),bodyKind:'html',serverHint:'cloudflare',cfRayPresent:true}:f.request(q)});
 assert.equal(r.canResumeImport,true);assert.equal(r.publicPathSpecificDenial,true);assert.equal(r.public403Source,'PUBLIC_PATH_DENIAL_NATIVE_API_ACCEPTS_SAME_KEY');assert.equal(r.evidence.public.credentialList.errorCategory,'UNCLASSIFIED_DENIAL');
});
test('direct n8n denial and global-list-only denial are distinguished without suggesting replacement keys',async()=>{
 const f=fixture();for(const targetReadAllowed of [true,false]){const r=await diagnoseN8nAccess({...config,request:async q=>q.route.includes('/credentials?')||!targetReadAllowed&&q.route.endsWith('/google1')?response(403,{message:'Missing required scope credential:list'}):f.request(q)});assert.equal(r.canResumeImport,targetReadAllowed);assert.equal(r.diagnosis,targetReadAllowed?'GLOBAL_LIST_DENIED_TARGET_READ_ALLOWED':'DIRECT_N8N_API_DENIAL_PROVEN');assert.equal(r.evidence.internal.credentialList.errorCategory,'REQUIRED_SCOPE_DENIED');assert.deepEqual(r.evidence.internal.credentialList.errorMentionsScopes,['credential:list']);}
});
test('unproven native health, wrong project or unexpected secret-bearing credential cannot pass preflight',async()=>{
 for(const mode of ['health','project','secrets']){const f=fixture();const r=await diagnoseN8nAccess({...config,request:async q=>{const r=await f.request(q);if(mode==='health'&&q.origin==='internal'&&q.route==='/healthz')return{transportError:'ECONNREFUSED'};if(mode==='project'&&r.data?.data?.[0]?.shared)r.data.data[0].shared=[{id:'wrong'}];if(mode==='secrets'&&q.route.includes('/credentials')){if(r.data?.data?.[0])r.data.data[0].data={secret:config.key};else r.data.data={secret:config.key};}return r;}});assert.equal(r.canResumeImport,false);assert.ok(!JSON.stringify(r).includes(config.key));}
});
test('error reports reveal no raw messages, response secrets, cookies, token or unclassified infrastructure values',()=>{
 const r=safeApiEvidence({...response(403,{message:'PRIVATE_NOT_RETURNED '+config.key+' missing scope credential:list',token:config.key}),headers:{'set-cookie':config.key},serverHint:'unidentified'});assert.equal(r.errorCategory,'REQUIRED_SCOPE_DENIED');assert.equal(r.rawBodyDisclosed,false);assert.ok(!JSON.stringify(r).includes('PRIVATE_NOT_RETURNED'));assert.ok(!JSON.stringify(r).includes(config.key));
});
test('SSH RPC accepts stdin JSON but blocks arbitrary hosts/routes and never puts secrets into its command',async()=>{
 const command=rpcCommand();assert.ok(!command.includes(config.key));assert.match(command,/^node --input-type=module -e '/);
 const r=spawnSync('bash',['-c',command],{input:JSON.stringify({origin:'internal',method:'POST',route:'/api/v1/credentials/google1/test',headers:{'X-N8N-API-KEY':config.key}}),encoding:'utf8'});assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stdout),{transportError:'REMOTE_REQUEST_REJECTED'});assert.ok(!r.stdout.includes(config.key));assert.ok(!r.stderr.includes(config.key));
 await assert.rejects(remoteN8nHttp({origin:'attacker',method:'GET',route:'/healthz'}),/ORIGIN_INVALID/);await assert.rejects(remoteN8nHttp({method:'DELETE',route:'/api/v1/workflows/abc'}),/ROUTE_BLOCKED/);
});
test('remote JSON wrapper keeps native authorization errors and never falls back to another identity',async()=>{
 let count=0;await assert.rejects(remoteJson(async()=>{count++;return response(403,{message:config.key});},'/api/v1/credentials?limit=100'),e=>e.message==='CANARY_HTTP_403'&&e.httpStatus===403);assert.equal(count,1);
});
