// Runs inside the existing n8n container. Returns type/count only, never data,
// names, tokens or connection values. No credential export/decryption or writes.
export async function readN8nMailMetadata({env=process.env,loadPg}={}){
 let stage='configuration';const type=env.DB_TYPE||'sqlite';
 const failure=()=>({status:'METADATA_NOT_VERIFIED',databaseType:type==='postgresdb'?'postgresdb':type==='sqlite'?'sqlite':'unsupported',failureStage:stage,authorizationVerified:false});
 try{
  const fs=await import('node:fs');const path=await import('node:path');
  const secretFile=file=>{const s=fs.statSync(file);if(!s.isFile()||s.size>131072)throw Error();return fs.readFileSync(file,'utf8').trim();};
  const value=(name,fallback='')=>{if(env[name]&&env[name+'_FILE'])throw Error();return env[name+'_FILE']?secretFile(env[name+'_FILE']):env[name]??fallback;};
  const prefix=value('DB_TABLE_PREFIX'),schema=value('DB_POSTGRESDB_SCHEMA','public');
  if(!/^[a-zA-Z0-9_]{0,64}$/.test(prefix)||! /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))throw Error();
  const types=['gmailOAuth2','smtp','googleOAuth2Api'];let rows;
  if(type==='sqlite'){
   stage='sqlite_driver';const{DatabaseSync}=await import('node:sqlite');
   const database=path.resolve(value('N8N_USER_FOLDER','/home/node'),'.n8n',value('DB_SQLITE_DATABASE','database.sqlite'));
   stage='sqlite_metadata';const db=new DatabaseSync(database,{readOnly:true});
   try{rows=db.prepare('SELECT type,count(*) AS count FROM "'+prefix+'credentials_entity" WHERE type IN (?,?,?) GROUP BY type').all(...types);}finally{db.close();}
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
   const client=new pg.Client({host,port,user:value('DB_POSTGRESDB_USER','postgres'),database:value('DB_POSTGRESDB_DATABASE','n8n'),password:value('DB_POSTGRESDB_PASSWORD'),ssl,application_name:'shadowbridge_mail_metadata_readonly',connectionTimeoutMillis:5000,query_timeout:6000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'});
   let connected=false;try{
    stage='postgres_connection';await client.connect();connected=true;stage='postgres_metadata';await client.query('BEGIN READ ONLY');
    if((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only!=='on')throw Error();
    rows=(await client.query('SELECT type,count(*)::integer AS count FROM "'+schema+'"."'+prefix+'credentials_entity" WHERE type=ANY($1::text[]) GROUP BY type',[types])).rows;
   }finally{if(connected){try{await client.query('ROLLBACK');}finally{await client.end();}}else await client.end().catch(()=>{});}
  }else return{status:'METADATA_NOT_VERIFIED_UNSUPPORTED_DATABASE',authorizationVerified:false};
  return{status:'METADATA_READ_ONLY',databaseType:type,authorizationVerified:false,gmailOAuthCandidates:Number(rows.find(r=>r.type==='gmailOAuth2')?.count||0),smtpCandidates:Number(rows.find(r=>r.type==='smtp')?.count||0),googleOAuthCandidates:Number(rows.find(r=>r.type==='googleOAuth2Api')?.count||0)};
 }catch{return failure();}
}
export function n8nMailMetadataCode(){return 'console.log(JSON.stringify(await ('+readN8nMailMetadata.toString()+')()));';}
