// Structured subprocess diagnostics. Never return command arguments or raw output
// in an error. Remote state is uncertain after transport loss: no automatic retry.
import{spawn}from'node:child_process';
const safeToken=(v,pattern)=>typeof v==='string'&&pattern.test(v)?v:undefined;
export function externalFailure(result,{stage='unknown',command='external'}={}){
 let reason='EXTERNAL_COMMAND_FAILED';const stderr=result.stderr||'',stdout=result.stdout||'';
 if(result.errorCode==='ENOENT')reason='LOCAL_COMMAND_NOT_FOUND';
 else if(result.timedOut||result.errorCode==='ETIMEDOUT')reason='EXTERNAL_COMMAND_TIMEOUT_CHECK_CHECKPOINT';
 else if(/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr))reason='SSH_HOST_KEY_VERIFICATION_FAILED';
 else if(/Permission denied.*(?:publickey|password)|Authentication failed/i.test(stderr))reason='SSH_AUTHENTICATION_FAILED';
 else if(/Connection refused/i.test(stderr))reason='SSH_CONNECTION_REFUSED';
 else if(/Connection timed out|Operation timed out/i.test(stderr))reason='SSH_CONNECTION_TIMEOUT';
 else if(/Could not resolve hostname/i.test(stderr))reason='SSH_HOSTNAME_UNRESOLVED';
 else if(/incorrect password attempts|sudo:.*password is required|sudo:.*authentication failure/i.test(stderr+stdout))reason='SUDO_AUTHENTICATION_FAILED';
 const diagnostic={status:'BLOCKED',reason,stage:safeToken(stage,/^[a-zA-Z0-9_.-]{1,100}$/)||'unknown',command:['ssh','scp','node'].includes(command)?command:'external',exitCode:Number.isInteger(result.exitCode)?result.exitCode:null,signal:safeToken(result.signal,/^[A-Z0-9]{1,20}$/)||null,checkpointRetained:true,automaticRetry:false,noSuccessClaimed:true};
 for(const line of (stdout+'\n'+stderr).split(/\r?\n/).reverse()){try{const d=JSON.parse(line);if(d.status==='BLOCKED'){const code=safeToken(d.reason,/^(?:SMTP_|GMAIL_|OPERATOR_|FRESH_|PRIVATE_|SOURCE_|ACTIVE_|ACCEPTED_|PINNED_|LIVE_|AUTH_|APP_|N8N_|INSUFFICIENT_|EXISTING_|MAIL_|OWNER_|PRODUCTION_|MIGRATION_|UNIQUE_|TLS_|HTTPS_|LOCAL_|AUTHORIZED_|RECOVERY_|UNRECORDED_|SEALED_|BASELINE_|CHECKPOINT_|INVALID_|TRANSFER_|BACKUP_)[A-Z0-9_]{1,110}$/);if(code){diagnostic.remoteCode=code;diagnostic.remoteStage=safeToken(d.stage,/^[a-zA-Z0-9_.-]{1,80}$/)||null;diagnostic.reason='REMOTE_OPERATOR_BLOCKED';break;}}}catch{}}
 return diagnostic;
}
export function launcherFailure(error){if(error?.diagnostic)return error.diagnostic;return{status:'BLOCKED',reason:safeToken(error?.message,/^[A-Z_]{4,120}$/)||'OWNER_ACTION_INCOMPLETE_RETAIN_CHECKPOINT',stage:safeToken(error?.stage,/^[a-zA-Z0-9_.-]{1,100}$/)||'launcher',checkpointRetained:true,automaticRetry:false,noSuccessClaimed:true};}
export async function executeExternal(bin,args,{capture=false,tee=false,stage='unknown',timeout=180000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,args,{stdio:['inherit','pipe','pipe']});let stdout='',stderr='',errorCode,timedOut=false;
  const retain=(old,chunk)=>(old+chunk.toString('utf8')).slice(-1048576);
  child.stdout.on('data',b=>{stdout=retain(stdout,b);if(!capture||tee)process.stdout.write(b);});
  child.stderr.on('data',b=>{stderr=retain(stderr,b);if(!capture||tee)process.stderr.write(b);});
  child.on('error',e=>{errorCode=e.code;});const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeout);
  child.on('close',(exitCode,signal)=>{clearTimeout(timer);if(errorCode||timedOut||exitCode!==0){const e=Error('EXTERNAL_COMMAND_FAILED');e.diagnostic=externalFailure({stdout,stderr,exitCode,signal,errorCode,timedOut},{stage,command:bin});reject(e);}else resolve(capture?stdout.trim():'');});
 });
}
