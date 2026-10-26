// Metadata-only channel discovery. No SMTP login, send, credential decryption,
// bootstrap, configuration write or application restart.
export function validWizardEmail(value){
 if(typeof value!=='string')throw Error('MAIL_RECIPIENT_INVALID');
 const email=value.trim().toLowerCase();
 if(email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)||/[\r\n]/.test(value))throw Error('MAIL_RECIPIENT_INVALID');
 return email;
}
export function mailChannelProbeCode(recipient){
 const email=validWizardEmail(recipient);
 const inventory=`
  try {
   if ((process.env.DB_TYPE||'sqlite')!=='sqlite') {console.log(JSON.stringify({status:'METADATA_NOT_VERIFIED_NON_SQLITE',authorizationVerified:false}));}
   else {
    const {DatabaseSync}=await import('node:sqlite');const path=await import('node:path');
    const prefix=process.env.DB_TABLE_PREFIX||'';if(!/^[a-zA-Z0-9_]{0,64}$/.test(prefix))throw Error();
    const database=path.resolve(process.env.N8N_USER_FOLDER||'/home/node','.n8n',process.env.DB_SQLITE_DATABASE||'database.sqlite');
    const db=new DatabaseSync(database,{readOnly:true});
    try {const rows=db.prepare('SELECT type,count(*) AS count FROM "'+prefix+'credentials_entity" WHERE type IN (?,?) GROUP BY type').all('gmailOAuth2','smtp');
    console.log(JSON.stringify({status:'METADATA_READ_ONLY',authorizationVerified:false,gmailOAuthCandidates:Number(rows.find(r=>r.type==='gmailOAuth2')?.count||0),smtpCandidates:Number(rows.find(r=>r.type==='smtp')?.count||0)}));}
    finally{db.close();}
   }
  } catch {console.log(JSON.stringify({status:'METADATA_NOT_VERIFIED',authorizationVerified:false}));}`;
 return `import{execFileSync}from'node:child_process';import{lstat,readFile}from'node:fs/promises';import{hostname}from'node:os';
const report={kind:'shadowbridge-existing-mail-channel',readOnly:true,changesMade:false,recipient:${JSON.stringify(email)},codeSent:false,deliveryVerified:false,publicSignup:false};
const run=a=>execFileSync('docker',['--context','default',...a],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:16*1024**2});
const env=c=>Object.fromEntries((c.Config.Env||[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
try{
 if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');
 const ids=run(['ps','-q']).trim().split('\\n').filter(Boolean),all=ids.length?JSON.parse(run(['inspect',...ids])):[];
 const apps=all.filter(c=>c.Config.Labels?.['com.docker.compose.service']==='app'&&env(c).RELEASE_SHA==='80f4a0d333d31a6d57ada714b0df17bc0584a07b');
 if(apps.length!==1)throw Error('ACCEPTED_APP_NOT_UNIQUE');
 const app=apps[0],project=app.Config.Labels['com.docker.compose.project'],auth=all.filter(c=>c.Config.Labels?.['com.docker.compose.project']===project&&c.Config.Labels?.['com.docker.compose.service']==='auth');
 if(auth.length!==1)throw Error('AUTH_NOT_UNIQUE');const a=env(auth[0]);
 report.runtime={release:env(app).RELEASE_SHA,healthy:app.State.Health?.Status==='healthy',mailMode:['disabled','allowlist','smtp'].includes(env(app).MAIL_DELIVERY_MODE)?env(app).MAIL_DELIVERY_MODE:'UNKNOWN'};
 report.auth={externalSmtpConfigured:!!a.GOTRUE_SMTP_HOST&&!['127.0.0.1','localhost','mailpit'].includes(a.GOTRUE_SMTP_HOST)&&!!a.GOTRUE_SMTP_USER&&!!a.GOTRUE_SMTP_PASS,smtpCredentialPresent:!!a.GOTRUE_SMTP_PASS,signupDisabled:a.GOTRUE_DISABLE_SIGNUP==='true',authorizationVerified:false};
 const n8n=all.find(c=>c.Name==='/shadowbridge-automation-n8n-1');
 if(n8n){try{report.n8n=JSON.parse(run(['exec',n8n.Id,'node','--input-type=module','-e',${JSON.stringify(inventory)}]));}catch{report.n8n={status:'METADATA_NOT_VERIFIED',authorizationVerified:false};}}
 else report.n8n={status:'NOT_RUNNING',authorizationVerified:false};
 const old='/opt/shadowbridge-operators/smtp-cbca6a0c4ef9559081aaac7347370a774331b8ea/.local/smtp-package-cbca6a0c4ef9559081aaac7347370a774331b8ea';
 report.previousAttempt={};for(const [key,file]of Object.entries({checkpoint:old+'/operator-state.json',lock:'/opt/shadowbridge/.local/smtp-operator-lock/operation.lock',credential:old+'/smtp-credential.env'})){try{const s=await lstat(file);report.previousAttempt[key]={exists:true,regular:s.isFile()&&!s.isSymbolicLink(),mode:(s.mode&511).toString(8)};}catch(e){report.previousAttempt[key]={exists:e.code==='ENOENT'?false:null};}}
 const candidate=report.auth.externalSmtpConfigured||(report.n8n.gmailOAuthCandidates||0)>0||(report.n8n.smtpCandidates||0)>0;
 report.status='BLOCKED';report.reason=candidate?'EXISTING_MAIL_CANDIDATE_REQUIRES_AUTHORIZED_SEND_TEST':report.n8n.status==='METADATA_READ_ONLY'?'NO_AUTHORIZED_MAIL_CHANNEL_FOUND':'NO_AUTHORIZED_MAIL_CHANNEL_PROVEN_N8N_UNVERIFIED';
 report.missingDependency=candidate?'Validate existing SMTP/OAuth authorization server-side before any message.':'One-time outbound authorization for an existing sender. Inbox access and recipient address do not authorize sending.';
}catch(e){report.status='BLOCKED';report.reason=/^[A-Z_]{4,100}$/.test(e.message||'')?e.message:'READ_ONLY_MAIL_DISCOVERY_FAILED';}
console.log(JSON.stringify(report,null,2));`;
}
