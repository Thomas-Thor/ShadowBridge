// Targeted continuation after n8n API READ=200. No repeat health/resource audit.
import {execFileSync} from 'node:child_process';
import {hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
// Existing n8n metadata only. SQL returns predefined buckets/counts, never raw
// credential names, IDs, encrypted data, tokens or connection values. No writes.
export async function readN8nAcquisitionMetadata({env=process.env,loadPg}={}){
 let stage='configuration';const type=env.DB_TYPE||'sqlite';
 const failure=()=>({status:'METADATA_NOT_VERIFIED',databaseType:type==='postgresdb'?'postgresdb':type==='sqlite'?'sqlite':'unsupported',failureStage:stage,authorizationVerified:false});
 try{
  const fs=await import('node:fs');const path=await import('node:path');
  const secretFile=file=>{const s=fs.statSync(file);if(!s.isFile()||s.size>131072)throw Error();return fs.readFileSync(file,'utf8').trim();};
  const value=(name,fallback='')=>{if(env[name]&&env[name+'_FILE'])throw Error();return env[name+'_FILE']?secretFile(env[name+'_FILE']):env[name]??fallback;};
  const prefix=value('DB_TABLE_PREFIX'),schema=value('DB_POSTGRESDB_SCHEMA','public');
  if(!/^[a-zA-Z0-9_]{0,64}$/.test(prefix)||! /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))throw Error();
  const bucket="CASE WHEN type='googleSheetsOAuth2Api' THEN 'googleSheetsOAuth' WHEN type='googleApi' THEN 'googleServiceAccount' WHEN type='googleOAuth2Api' THEN 'genericGoogleOAuth' WHEN type='googleSheetsTriggerOAuth2Api' THEN 'googleSheetsTrigger' WHEN lower(type||' '||name) LIKE '%apollo%' THEN 'apolloHint' WHEN lower(type||' '||name) LIKE '%clay%' THEN 'clayHint' WHEN type IN ('httpHeaderAuth','httpCustomAuth','httpQueryAuth','oAuth2Api','httpBasicAuth') THEN 'genericHttpUnclassified' ELSE 'otherUnclassified' END";
  let rows;
  if(type==='sqlite'){
   stage='sqlite_driver';const{DatabaseSync}=await import('node:sqlite');
   const database=path.resolve(value('N8N_USER_FOLDER','/home/node'),'.n8n',value('DB_SQLITE_DATABASE','database.sqlite'));
   stage='sqlite_metadata';const db=new DatabaseSync(database,{readOnly:true});
   try{rows=db.prepare('SELECT '+bucket+' AS bucket,count(*) AS count FROM "'+prefix+'credentials_entity" GROUP BY 1').all();}finally{db.close();}
  }else if(type==='postgresdb'){
   stage='postgres_driver';let pg;
   if(loadPg)pg=await loadPg();else{
    const{createRequire}=await import('node:module');const roots=[process.cwd(),'/usr/local/lib/node_modules/n8n','/opt/n8n/node_modules/n8n'];
    try{roots.unshift(path.dirname(path.dirname(fs.realpathSync('/usr/local/bin/n8n'))));}catch{}
    for(const root of roots){try{pg=createRequire(path.join(root,'package.json'))('pg');break;}catch{}}
   }
   if(typeof pg?.Client!=='function')throw Error();stage='postgres_configuration';
   const host=value('DB_POSTGRESDB_HOST','localhost'),port=Number(value('DB_POSTGRESDB_PORT','5432'));
   if(!host||!Number.isInteger(port)||port<1||port>65535||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error();
   const ca=value('DB_POSTGRESDB_SSL_CA'),cert=value('DB_POSTGRESDB_SSL_CERT'),key=value('DB_POSTGRESDB_SSL_KEY'),enabled=value('DB_POSTGRESDB_SSL_ENABLED','false');
   if(!['true','false'].includes(enabled)||!['true','false'].includes(value('DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED','true')))throw Error();
   const sslEnabled=enabled==='true'||!!ca||!!cert||!!key;
   if(sslEnabled&&value('DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED','true')!=='true')throw Error();
   const pem=v=>v.includes('-----BEGIN ')?v:secretFile(v);
   const ssl=sslEnabled?{rejectUnauthorized:true,servername:host,...(ca?{ca:pem(ca)}:{}),...(cert?{cert:pem(cert)}:{}),...(key?{key:pem(key)}:{})}:false;
   const client=new pg.Client({host,port,user:value('DB_POSTGRESDB_USER','postgres'),database:value('DB_POSTGRESDB_DATABASE','n8n'),password:value('DB_POSTGRESDB_PASSWORD'),ssl,application_name:'shadowbridge_acquisition_metadata_readonly',connectionTimeoutMillis:5000,query_timeout:6000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'});
   let connected=false;try{
    stage='postgres_connection';await client.connect();connected=true;stage='postgres_metadata';await client.query('BEGIN READ ONLY');
    if((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only!=='on')throw Error();
    rows=(await client.query('SELECT '+bucket+' AS bucket,count(*)::integer AS count FROM "'+schema+'"."'+prefix+'credentials_entity" GROUP BY 1')).rows;
   }finally{if(connected){try{await client.query('ROLLBACK');}finally{await client.end();}}else await client.end().catch(()=>{});}
  }else return{status:'METADATA_NOT_VERIFIED_UNSUPPORTED_DATABASE',authorizationVerified:false};
  const counts=Object.fromEntries(['apolloHint','clayHint','googleSheetsOAuth','googleServiceAccount','genericGoogleOAuth','googleSheetsTrigger','genericHttpUnclassified','otherUnclassified'].map(k=>[k,Number(rows.find(r=>r.bucket===k)?.count||0)]));
  if(Object.values(counts).some(v=>!Number.isSafeInteger(v)||v<0))throw Error();
  return{status:'METADATA_READ_ONLY',databaseType:type,credentialCandidates:counts,totalCredentials:Object.values(counts).reduce((a,b)=>a+b,0),authorizationVerified:false,providerCreditsVerified:false,googleSheetsWriteReadVerified:false,hintsAreNotProviderAuthorization:true,encryptedCredentialDataRead:false};
 }catch{return failure();}
}

export function acquisitionMetadataCode(){return 'console.log(JSON.stringify(await ('+readN8nAcquisitionMetadata.toString()+')()));';}
export function main(){
 if(process.argv.slice(2).join(' ')!=='--read-only'||process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_CONTABO_REQUIRED');
 const docker=(args,input)=>execFileSync('docker',['--context','default',...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:1048576}).trim();
 const endpoint=JSON.parse(docker(['context','inspect','default','--format','{{json .Endpoints.docker}}']));
 if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint.Host))throw Error('LOCAL_DOCKER_REQUIRED');
 const c=JSON.parse(docker(['inspect','shadowbridge-automation-n8n-1']))[0];
 if(c.Name!=='/shadowbridge-automation-n8n-1'||c.State.Running!==true)throw Error('EXISTING_N8N_REQUIRED');
 const result=JSON.parse(docker(['exec','-i',c.Id,'node','--input-type=module','-e',acquisitionMetadataCode()]));
 console.log(JSON.stringify({kind:'shadowbridge-acquisition-credential-metadata',observedAt:new Date().toISOString(),readOnly:true,changesMade:false,apiKeyRequested:false,providerCalls:0,crmWrites:0,scheduled:false,executed:false,n8n:result},null,2));
}
if(process.argv[1]===fileURLToPath(import.meta.url))try{main();}catch{console.error(JSON.stringify({status:'BLOCKED',reason:'ACQUISITION_METADATA_UNVERIFIED',readOnly:true,changesMade:false,providerCalls:0,crmWrites:0}));process.exitCode=2;}
