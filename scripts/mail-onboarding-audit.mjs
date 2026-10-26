// Standalone READ ONLY: metadata/config flags + public DNS/HTTPS, never SMTP login/send.
import {execFileSync,spawnSync}from'node:child_process';
import {readFile,realpath}from'node:fs/promises';import{hostname}from'node:os';
import{Resolver}from'node:dns/promises';import{fileURLToPath}from'node:url';import path from'node:path';
const repo='/opt/shadowbridge',origin='https://shadow-bridge.eu',formal='shadowbridge.trade@gmail.com';
const bool=v=>v==='true'?true:v==='false'?false:null;
const number=v=>/^\d{1,8}$/.test(v||'')?Number(v):null;
const revision=v=>/^[a-f0-9]{40}$/.test(v||'')?v:null;
const env=c=>Object.fromEntries((c?.Config?.Env||[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
export function summarizeMail(app={},auth={},networks=[]){
 const a=env(app),g=env(auth),provider=g.GOTRUE_SMTP_HOST==='smtp.gmail.com'?'GMAIL':g.GOTRUE_SMTP_HOST==='mailpit'?'MAILPIT_CAPTURE':['127.0.0.1','localhost'].includes(g.GOTRUE_SMTP_HOST)?'LOOPBACK':'OTHER_OR_UNKNOWN';
 return{release:revision(a.RELEASE_SHA),app:{mailMode:['disabled','captured','allowlist','smtp'].includes(a.MAIL_DELIVERY_MODE)?a.MAIL_DELIVERY_MODE:'UNKNOWN',transactionalMailEnabled:bool(a.TRANSACTIONAL_MAIL_ENABLED),publicOriginCorrect:a.APP_URL===origin},auth:{signupDisabled:bool(g.GOTRUE_DISABLE_SIGNUP),autoconfirm:bool(g.GOTRUE_MAILER_AUTOCONFIRM),emailEnabled:bool(g.GOTRUE_EXTERNAL_EMAIL_ENABLED),siteUrlCorrect:g.GOTRUE_SITE_URL===origin,confirmationPathCorrect:g.GOTRUE_MAILER_URLPATHS_CONFIRMATION==='/auth/confirm',recoveryPathCorrect:g.GOTRUE_MAILER_URLPATHS_RECOVERY==='/auth/recover',redirectAllowlistExact:g.GOTRUE_URI_ALLOW_LIST===origin+'/auth/confirm,'+origin+'/auth/recover',totpVerifyEnabled:bool(g.GOTRUE_MFA_TOTP_VERIFY_ENABLED),smtpProvider:provider,smtpPort:number(g.GOTRUE_SMTP_PORT),smtpCredentialPresent:!!g.GOTRUE_SMTP_PASS,smtpUsernamePresent:!!g.GOTRUE_SMTP_USER,senderMatchesFormal:g.GOTRUE_SMTP_ADMIN_EMAIL===formal,usernameMatchesFormal:g.GOTRUE_SMTP_USER===formal,emailRateLimit:number(g.GOTRUE_RATE_LIMIT_EMAIL_SENT),smtpMaxFrequencyExplicit:!!g.GOTRUE_SMTP_MAX_FREQUENCY,otpExpirySecondsExplicit:number(g.GOTRUE_MAILER_OTP_EXP),captchaConfigured:g.GOTRUE_SECURITY_CAPTCHA_ENABLED==='true',publishedPorts:Object.values(auth.HostConfig?.PortBindings||{}).some(v=>Array.isArray(v)&&v.length>0),networks:networks.map(n=>({name:n.Name,internal:n.Internal===true})),onlyInternalNetworks:networks.length>0&&networks.every(n=>n.Internal===true)},delivery:{smtpAuthenticationTested:false,messageSent:false,deliveredToRealInbox:false,dnsAlignmentProven:false}};
}
export function mailBlockers(s){
 const b=[];if(s.app.mailMode!=='smtp'||s.app.transactionalMailEnabled!==true)b.push('PRODUCTION_TRANSACTIONAL_MAIL_DISABLED_OR_UNPROVEN');
 if(s.auth.signupDisabled!==false)b.push('PUBLIC_SIGNUP_DISABLED_OR_UNPROVEN');
 if(s.auth.autoconfirm!==false||s.auth.emailEnabled!==true)b.push('EMAIL_CONFIRMATION_POLICY_UNPROVEN');
 if(!s.auth.siteUrlCorrect||!s.app.publicOriginCorrect||!s.auth.confirmationPathCorrect||!s.auth.recoveryPathCorrect||!s.auth.redirectAllowlistExact)b.push('PUBLIC_EMAIL_URLS_REQUIRE_REVIEW');
 if(!s.auth.smtpCredentialPresent||!s.auth.smtpUsernamePresent||s.auth.smtpProvider!=='GMAIL')b.push('APPROVED_GMAIL_SMTP_NOT_CONFIGURED');
 if(!s.auth.senderMatchesFormal||!s.auth.usernameMatchesFormal)b.push('APPROVED_SENDER_IDENTITY_UNPROVEN');
 if(s.auth.onlyInternalNetworks)b.push('AUTH_HAS_NO_DIRECT_EXTERNAL_SMTP_ROUTE');
 if(s.auth.smtpProvider==='GMAIL'&&s.auth.smtpPort!==465)b.push('APPROVED_GMAIL_IMPLICIT_TLS_PORT_NOT_PROVEN');
 if(s.auth.totpVerifyEnabled!==true||s.auth.publishedPorts)b.push('AUTH_SECURITY_REQUIRES_REVIEW');
 if(!s.auth.otpExpirySecondsExplicit)b.push('TOKEN_EXPIRY_REQUIRES_EXPLICIT_REVIEW');
 if(s.auth.emailRateLimit===null||!s.auth.smtpMaxFrequencyExplicit)b.push('EMAIL_LIMITS_REQUIRE_REVIEW');
 b.push('CONTROLLED_REAL_DELIVERY_AND_OWNER_RELEASE_APPROVAL_REQUIRED');return b;
}
const run=(args)=>{try{return execFileSync('docker',['--context','default',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:16*1024**2}).trim();}catch{throw Error('DOCKER_READ_UNAVAILABLE');}};
async function dnsEvidence(){
 const resolver=new Resolver({timeout:2500,tries:1}),rows=[];for(const [name,kind]of [['shadow-bridge.eu','TXT'],['_dmarc.shadow-bridge.eu','TXT'],['shadow-bridge.eu','MX']]){
  try{const data=await(kind==='MX'?resolver.resolveMx(name):resolver.resolveTxt(name));
   const values=kind==='MX'?data.map(v=>({exchange:v.exchange,priority:v.priority})):data.map(v=>v.join('')).filter(v=>/^v=(spf1|DMARC1)\b/i.test(v));rows.push({name,kind,status:'READ',records:values});
  }catch(e){rows.push({name,kind,status:['ENODATA','ENOTFOUND','ETIMEOUT','ESERVFAIL','DNS_TIMEOUT'].includes(e.code||e.message)?e.code||e.message:'UNAVAILABLE'});}
 }return{observedAt:new Date().toISOString(),records:rows,dkim:'NOT_PROVEN: selector and delivered-message signatures must be reviewed; no selector guessed',senderDomain:'gmail.com',note:'The formal sender is Gmail. Website-domain SPF/MX/DMARC alone do not prove alignment for Gmail; review actual delivered headers before release.'};
}
export async function collectMailAudit(){
 if(process.geteuid?.()!==0||hostname()!=='vmi3682957'||await realpath(repo)!==repo)throw Error('WRONG_AUDIT_HOST');
 const endpoint=JSON.parse(run(['context','inspect','default','--format','{{json .Endpoints.docker}}']));if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint.Host))throw Error('LOCAL_DOCKER_REQUIRED');
 const ids=run(['ps','-q','--filter','label=com.docker.compose.service=app']).split('\n').filter(Boolean);if(!ids.length)throw Error('APP_NOT_FOUND');
 const raw=JSON.parse(run(['inspect',...ids])),apps=raw.filter(c=>c.State.Running&&(c.Config.Labels?.['com.docker.compose.project.config_files']||'').split(',').some(p=>p.startsWith(repo+'/')));if(apps.length!==1)throw Error('UNIQUE_APP_NOT_PROVEN');
 const app=apps[0],project=app.Config.Labels['com.docker.compose.project'];if(!/^[a-zA-Z0-9_-]{1,128}$/.test(project))throw Error('PROJECT_UNPROVEN');
 const authIds=run(['ps','-q','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=auth']).split('\n').filter(Boolean);if(authIds.length!==1)throw Error('UNIQUE_AUTH_NOT_PROVEN');
 const auth=JSON.parse(run(['inspect',authIds[0]]))[0],names=Object.keys(auth.NetworkSettings?.Networks||{}),networks=names.length?JSON.parse(run(['network','inspect',...names])):[];
 const summary=summarizeMail(app,auth,networks);let capabilities={status:'UNAVAILABLE'};
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0')try{const r=await fetch(origin+'/api/config',{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)}),d=await r.json();capabilities={status:r.status,tlsVerificationEnabled:true,release:revision(d.releaseSha),registration:d.capabilities?.registration??null,passwordRecovery:d.capabilities?.passwordRecovery??null,emailVerification:d.capabilities?.emailVerification??null};}catch{}
 return{kind:'shadowbridge-mail-onboarding-read-only-audit',observedAt:new Date().toISOString(),readOnly:true,changesMade:false,status:'BLOCKED_FOR_ACTIVATION',...summary,publicCapabilities:capabilities,blockers:mailBlockers(summary),dns:await dnsEvidence(),providerLimits:'NOT_VERIFIED: no SMTP authentication, provider account or billing API accessed',businessMailbox:'OWNER reports restored Gmail access; browser sign-in is not proof of SMTP authorization',applicationImage:app.Image,authImage:auth.Image,limitations:['No production SMTP login/send, signup, password reset, MFA challenge, configuration edit, migration, service restart or checkpoint change.','No ENV values, passwords, tokens, cookies or SMTP responses displayed.','A direct SMTP route is assessed from networks only; no TCP or SMTP authentication attempt was made.']};
}
async function sshAudit(){if(!process.stdin.isTTY)throw Error('INTERACTIVE_OWNER_TERMINAL_REQUIRED');const source=await readFile(fileURLToPath(import.meta.url),'utf8'),code=source+'\ntry{console.log(JSON.stringify(await collectMailAudit(),null,2));}catch{console.log(JSON.stringify({status:"READ_ONLY_MAIL_AUDIT_INCOMPLETE",changesMade:false}));process.exitCode=1;}\n',quote=s=>"'"+s.replaceAll("'","'\\''")+"'";const r=spawnSync('ssh',['-t','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15','shadowadmin@169.58.232.69','sudo node --input-type=module -e '+quote(code)],{stdio:'inherit'});if(r.status!==0)process.exitCode=1;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==3||process.argv[2]!=='--ssh')throw Error('USE_READ_ONLY_--ssh');sshAudit().catch(()=>{console.error('READ_ONLY_MAIL_AUDIT_INCOMPLETE');process.exitCode=1;});}
