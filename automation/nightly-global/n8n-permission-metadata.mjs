// Administrative READ ONLY diagnosis of an already refused credential POST.
// Never imports, changes scopes, reads/decrypts credential data or retries writes.
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {lstat,realpath,readFile} from 'node:fs/promises';
import {hostname} from 'node:os';import {createInterface} from 'node:readline/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';

export async function inspectN8nPermissionMetadata({keyHash,googleId,projectId},{env=process.env,loadPg}={}){
 let stage='configuration',version=null,client,connected=false;
 const must=(v,c)=>{if(!v)throw Error(c);};
 try{
  must(/^[a-f0-9]{64}$/.test(keyHash||'')&&[googleId,projectId].every(v=>/^[A-Za-z0-9_-]{1,100}$/.test(v||'')),'INPUT_INVALID');
  must(env.DB_TYPE==='postgresdb','EXISTING_POSTGRES_REQUIRED');
  const fs=await import('node:fs'),path=await import('node:path'),{createRequire}=await import('node:module');
  const readSecret=file=>{const s=fs.statSync(file);must(s.isFile()&&s.size<=131072,'PRIVATE_CONFIGURATION_INVALID');return fs.readFileSync(file,'utf8').trim();};
  const value=(name,fallback='')=>{must(!(env[name]&&env[name+'_FILE']),'CONFIGURATION_AMBIGUOUS');return env[name+'_FILE']?readSecret(env[name+'_FILE']):env[name]??fallback;};
  const roots=['/usr/local/lib/node_modules/n8n','/opt/n8n/node_modules/n8n',process.cwd()];try{roots.unshift(path.dirname(path.dirname(fs.realpathSync('/usr/local/bin/n8n'))));}catch{}
  let pg;
  for(const root of roots){try{const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(p.name==='n8n'&&/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(p.version))version=p.version;}catch{}if(!loadPg&&!pg)try{pg=createRequire(path.join(root,'package.json'))('pg');}catch{}}
  if(loadPg)pg=await loadPg();must(typeof pg?.Client==='function','EXISTING_POSTGRES_DRIVER_REQUIRED');
  const prefix=value('DB_TABLE_PREFIX'),schema=value('DB_POSTGRESDB_SCHEMA','public');must(/^[A-Za-z0-9_]{0,64}$/.test(prefix)&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema),'DATABASE_IDENTIFIERS_INVALID');
  const host=value('DB_POSTGRESDB_HOST','localhost'),port=Number(value('DB_POSTGRESDB_PORT','5432'));must(host&&Number.isInteger(port)&&port>0&&port<65536&&env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','DATABASE_CONNECTION_INVALID');
  const ca=value('DB_POSTGRESDB_SSL_CA'),cert=value('DB_POSTGRESDB_SSL_CERT'),key=value('DB_POSTGRESDB_SSL_KEY'),enabled=value('DB_POSTGRESDB_SSL_ENABLED','false');must(['true','false'].includes(enabled),'DATABASE_TLS_INVALID');
  const useTls=enabled==='true'||!!ca||!!cert||!!key;must(!useTls||value('DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED','true')==='true','DATABASE_TLS_REQUIRED');const pem=v=>v.includes('-----BEGIN ')?v:readSecret(v);
  const ssl=useTls?{rejectUnauthorized:true,servername:host,...(ca?{ca:pem(ca)}:{}),...(cert?{cert:pem(cert)}:{}),...(key?{key:pem(key)}:{})}:false;
  client=new pg.Client({host,port,user:value('DB_POSTGRESDB_USER','postgres'),database:value('DB_POSTGRESDB_DATABASE','n8n'),password:value('DB_POSTGRESDB_PASSWORD'),ssl,application_name:'shadowbridge_n8n_permission_metadata_readonly',connectionTimeoutMillis:5000,query_timeout:6000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'});
  stage='postgres.connection';await client.connect();connected=true;await client.query('BEGIN READ ONLY');must((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only==='on','READ_ONLY_REQUIRED');
  const table=n=>'"'+schema+'"."'+prefix+n+'"';
  stage='schema.metadata';const names=['user_api_keys','user','credentials_entity','shared_credentials','project_relation','workflow_entity','shared_workflow'];
  const columns=(await client.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])',[schema,names.map(n=>prefix+n)])).rows;
  const has=(t,c)=>columns.some(r=>r.table_name===prefix+t&&r.column_name===c);
  for(const[t,required]of Object.entries({user_api_keys:['apiKey','scopes','userId'],credentials_entity:['id','name','type'],shared_credentials:['credentialsId','projectId'],project_relation:['userId','projectId','role']}))must(required.every(c=>has(t,c)),'UNSUPPORTED_METADATA_SCHEMA');
  stage='key.scope.metadata';
  // Only a fingerprint is bound to SQL. No token is selected or returned. No
  // key, password, MFA or encrypted credentials column leaves PostgreSQL.
  const keys=(await client.query('SELECT "userId","scopes" FROM '+table('user_api_keys')+' WHERE encode(sha256(convert_to("apiKey",\'UTF8\')),\'hex\')=$1 LIMIT 2',[keyHash])).rows;
  must(keys.length===1,'EXACT_KEY_NOT_UNIQUELY_IDENTIFIED');const scopes=typeof keys[0].scopes==='string'?JSON.parse(keys[0].scopes):keys[0].scopes;must(Array.isArray(scopes)&&scopes.every(s=>typeof s==='string'),'KEY_SCOPES_FORMAT_UNSUPPORTED');
  const required=['credential:list','credential:read','credential:create','workflow:list','workflow:read','workflow:create','workflow:activate'],scopeChecks=Object.fromEntries(required.map(s=>[s,scopes.includes(s)]));
  stage='key.owner.role';let role='UNPROVEN',disabled=null;
  if(has('user','id')&&has('user','roleSlug')){const u=(await client.query('SELECT "roleSlug"'+(has('user','disabled')?',"disabled"':'')+' FROM '+table('user')+' WHERE "id"=$1',[keys[0].userId])).rows[0];if(u){role=['global:owner','global:admin','global:member'].includes(u.roleSlug)?u.roleSlug:'CUSTOM_ROLE';disabled=typeof u.disabled==='boolean'?u.disabled:null;}}
  stage='google.binding.metadata';const google=(await client.query('SELECT "id","name","type" FROM '+table('credentials_entity')+' WHERE "id"=$1 LIMIT 2',[googleId])).rows;
  const shared=(await client.query('SELECT "projectId" FROM '+table('shared_credentials')+' WHERE "credentialsId"=$1 AND "projectId"=$2',[googleId,projectId])).rows;
  const membership=(await client.query('SELECT "role" FROM '+table('project_relation')+' WHERE "userId"=$1 AND "projectId"=$2',[keys[0].userId,projectId])).rows;
  const projectRole=membership.length===1?(['project:personalOwner','project:admin','project:editor','project:viewer'].includes(membership[0].role)?membership[0].role:'CUSTOM_ROLE'):null;
  stage='attempt.artifact.metadata';
  const ingress=(await client.query('SELECT count(*)::integer AS count FROM '+table('credentials_entity')+' c JOIN '+table('shared_credentials')+' s ON s."credentialsId"=c."id" WHERE c."name"=$1 AND c."type"=$2 AND s."projectId"=$3',['ShadowBridge private Clay intake','httpHeaderAuth',projectId])).rows[0]?.count;
  let workflows=null;if(['id','name'].every(c=>has('workflow_entity',c))&&['workflowId','projectId'].every(c=>has('shared_workflow',c)))workflows=(await client.query('SELECT count(*)::integer AS count FROM '+table('workflow_entity')+' w JOIN '+table('shared_workflow')+' s ON s."workflowId"=w."id" WHERE w."name"=$1 AND s."projectId"=$2',['ShadowBridge Global B2B Sourcing V1',projectId])).rows[0]?.count;
  must(Number.isSafeInteger(ingress)&&ingress>=0&&(workflows===null||Number.isSafeInteger(workflows)&&workflows>=0),'METADATA_COUNTS_INVALID');
  return{status:'METADATA_READ_ONLY_CONFIRMED',n8nVersion:version,exactExistingKeyIdentified:true,configuredScopeChecks:scopeChecks,keyOwnerGlobalRole:role,keyOwnerDisabled:disabled,selectedGoogleCredential:google.length===1?{id:google[0].id,name:google[0].name,type:google[0].type}:null,googleCredentialSharedWithTarget:shared.length>0,keyOwnerTargetProjectMembershipExists:membership.length>0,keyOwnerTargetProjectRole:projectRole,matchingIngressCredentials:ingress,matchingWorkflowCount:workflows,diagnosis:!scopeChecks['credential:create']?'EXACT_KEY_LACKS_CONFIGURED_CREDENTIAL_CREATE_SCOPE':disabled===true?'KEY_OWNER_DISABLED':membership.length===0&&!['global:owner','global:admin'].includes(role)?'TARGET_PROJECT_MEMBERSHIP_REQUIRES_REVIEW':'KEY_CREATE_SCOPE_PRESENT_REQUIRES_NATIVE_POLICY_REVIEW',apiAuthorizationNotOverridden:true,apiWrites:0,providerCalls:0,crmWrites:0,keyTokenSelected:false,credentialDataSelected:false,changesMade:false};
 }catch(e){const safe=['INPUT_INVALID','EXISTING_POSTGRES_REQUIRED','PRIVATE_CONFIGURATION_INVALID','CONFIGURATION_AMBIGUOUS','EXISTING_POSTGRES_DRIVER_REQUIRED','DATABASE_IDENTIFIERS_INVALID','DATABASE_CONNECTION_INVALID','DATABASE_TLS_INVALID','DATABASE_TLS_REQUIRED','READ_ONLY_REQUIRED','UNSUPPORTED_METADATA_SCHEMA','EXACT_KEY_NOT_UNIQUELY_IDENTIFIED','KEY_SCOPES_FORMAT_UNSUPPORTED','METADATA_COUNTS_INVALID'];return{status:'BLOCKED',reason:safe.includes(e.message)?e.message:'METADATA_READ_NOT_CONFIRMED',stage,n8nVersion:version,changesMade:false,secretsDisclosed:false};}
 finally{if(client){if(connected)try{await client.query('ROLLBACK');}catch{}await client.end().catch(()=>{});}}
}
async function hidden(){
 if(!process.stdin.isTTY)throw Error('INTERACTIVE_TERMINAL_REQUIRED');execFileSync('stty',['-echo'],{stdio:['inherit','ignore','ignore']});const rl=createInterface({input:process.stdin,output:process.stdout,terminal:false});
 try{let key=(await rl.question('Istniejący klucz n8n, tylko do identyfikacji metadanych (ukryty): ')).trim();if(key.startsWith('\x1b[200~')&&key.endsWith('\x1b[201~'))key=key.slice(6,-6).trim();if(!key||key.length>8192||/[\x00-\x1f\x7f-\x9f]/.test(key))throw Error('KEY_INPUT_INVALID');return createHash('sha256').update(key).digest('hex');}
 finally{rl.close();execFileSync('stty',['echo'],{stdio:['inherit','ignore','ignore']});process.stdout.write('\n');process.stdin.pause();}
}
export async function readPrivateMetadataRequest(file,uid){
 if(!Number.isSafeInteger(uid)||uid<0||!path.isAbsolute(file)||path.basename(file)!=='request.json')throw Error('PRIVATE_METADATA_REQUEST_REQUIRED');
 const dir=path.dirname(file),d=await lstat(dir),s=await lstat(file);
 if(!/^\/tmp\/shadowbridge-n8n-reconcile\.[A-Za-z0-9]+$/.test(dir)||!d.isDirectory()||d.isSymbolicLink()||d.uid!==uid||(d.mode&511)!==448||!s.isFile()||s.isSymbolicLink()||s.uid!==uid||(s.mode&511)!==384||s.size>16384||await realpath(file)!==file)throw Error('PRIVATE_METADATA_REQUEST_REQUIRED');
 const input=JSON.parse(await readFile(file,'utf8'));if(!/^[a-f0-9]{64}$/.test(input.keyHash||'')||!/^[a-f0-9-]{36}$/.test(input.requestId||'')||![input.googleId,input.projectId].every(v=>/^[A-Za-z0-9_-]{1,100}$/.test(v||'')))throw Error('PRIVATE_METADATA_REQUEST_INVALID');return input;
}
async function main(args=process.argv.slice(2)){
 const arg=k=>args.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3),expected=arg('host'),operator=arg('operator');
 if(!args.includes('--read-only')||!expected||hostname()!==expected||process.geteuid()!==0||!operator||process.env.SUDO_USER!==operator)throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');
 const googleId=arg('google'),projectId=arg('project');if(![googleId,projectId].every(v=>/^[A-Za-z0-9_-]{1,100}$/.test(v||'')))throw Error('EXISTING_BINDINGS_REQUIRED');
 const docker=(a,input)=>execFileSync('docker',['--context','default',...a],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:45000,maxBuffer:1048576}).trim();
 const endpoint=JSON.parse(docker(['context','inspect','default','--format','{{json .Endpoints.docker}}']));if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint.Host))throw Error('LOCAL_DOCKER_REQUIRED');
 const container='shadowbridge-automation-n8n-1';if(docker(['inspect','--format','{{json .State.Running}}',container])!=='true')throw Error('EXISTING_N8N_REQUIRED');
 const requestFile=arg('request-file'),request=requestFile?await readPrivateMetadataRequest(requestFile,Number(process.env.SUDO_UID)):null;
 if(request&&(request.googleId!==googleId||request.projectId!==projectId))throw Error('PRIVATE_METADATA_BINDING_MISMATCH');
 const keyHash=request?request.keyHash:await hidden();const code='let raw="";for await(const b of process.stdin){raw+=b;if(raw.length>16384)throw Error("INPUT_TOO_LARGE");}console.log(JSON.stringify(await ('+inspectN8nPermissionMetadata.toString()+')(JSON.parse(raw))));';
 const result=JSON.parse(docker(['exec','-i',container,'node','--input-type=module','-e',code],JSON.stringify({keyHash,googleId,projectId})));
 console.log(JSON.stringify({kind:'shadowbridge-n8n-credential-create-permission-metadata',observedAt:new Date().toISOString(),readOnly:true,checkpointChanged:false,rawKeySentToContainer:false,keyFingerprintDisclosed:false,targetProjectId:projectId,...(request?{operatorRequestId:request.requestId}:{}),...result}));if(result.status!=='METADATA_READ_ONLY_CONFIRMED')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({status:'BLOCKED',reason:'READ_ONLY_PERMISSION_METADATA_FAILED',changesMade:false,checkpointChanged:false,secretsDisclosed:false}));process.exitCode=2;});
