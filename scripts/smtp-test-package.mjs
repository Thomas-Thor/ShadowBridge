// Preparation library, not a production updater. No SSH, migrations or auto-activation.
import {mkdir,lstat,realpath,readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';import {isDeepStrictEqual}from'node:util';import path from'node:path';
import {gmailAuthSettings}from'./production-config.mjs';import{repositoryRoot}from'./staging-prepare.mjs';
import{encryptArchive,decryptArchive}from'./staging-backup.mjs';
export const smtpBaseline='80f4a0d333d31a6d57ada714b0df17bc0584a07b';
const must=(v,code)=>{if(!v)throw Error(code);},hash=v=>createHash('sha256').update(v).digest('hex');
const image=v=>/^sha256:[a-f0-9]{64}$/.test(v||'');
export function testRecipients(values){
 must(Array.isArray(values)&&values.length>0&&values.length<=10,'SMTP_TEST_RECIPIENTS_REQUIRED');
 const r=[...new Set(values.map(v=>{must(typeof v==='string','SMTP_INVALID_RECIPIENT');const s=v.trim().toLowerCase();must(s.length<=254&&!/[\r\n,*]/.test(s)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),'SMTP_INVALID_RECIPIENT');return s;}))];return r;
}
export function smtpCandidate(base,{emails,credentialFile,project}){
 const approved=testRecipients(emails);must(/^shadowbridge-[a-z0-9-]{3,80}$/.test(project||''),'SMTP_PROJECT_REQUIRED');
 must(base?.services?.app&&base.services.auth&&base.services.postgres,'SMTP_BASE_COMPOSE_REQUIRED');
 must(image(base.services.app.image)&&image(base.services.auth.image),'SMTP_IMMUTABLE_IMAGES_REQUIRED');
 must(base.services.app.environment?.RELEASE_SHA===smtpBaseline,'SMTP_ACCEPTED_BASE_REQUIRED');
 must(base.services.app.environment.MAIL_DELIVERY_MODE==='disabled'&&base.services.app.environment.TRANSACTIONAL_MAIL_ENABLED==='false','SMTP_DISABLED_BASE_REQUIRED');
 must(base.services.auth.environment?.GOTRUE_DISABLE_SIGNUP==='true'&&base.services.auth.environment.GOTRUE_MAILER_AUTOCONFIRM==='false'&&base.services.auth.environment.GOTRUE_MFA_TOTP_VERIFY_ENABLED==='true','SMTP_AUTH_BASE_REQUIRED');
 const origin=base.services.app.environment.APP_URL,g=base.services.auth.environment;must(typeof origin==='string'&&g.API_EXTERNAL_URL===origin&&g.GOTRUE_SITE_URL===origin&&g.GOTRUE_URI_ALLOW_LIST===origin+'/auth/confirm,'+origin+'/auth/recover'&&g.GOTRUE_MAILER_URLPATHS_CONFIRMATION==='/auth/confirm'&&g.GOTRUE_MAILER_URLPATHS_RECOVERY==='/auth/recover','SMTP_APPROVED_EMAIL_PATHS_REQUIRED');
 must(!base.services.auth.environment.GOTRUE_SMTP_PASS&&!base.services.auth.env_file,'SMTP_BASE_CREDENTIAL_UNEXPECTED');
 for(const name of ['postgres','auth','app'])must(!base.services[name].ports?.length,'SMTP_PRIVATE_SERVICE_PORTS_REQUIRED');
 must(path.isAbsolute(credentialFile)&&!/[\s\r\n\0$]/.test(credentialFile)&&path.normalize(credentialFile)===credentialFile,'SMTP_PRIVATE_CREDENTIAL_PATH_REQUIRED');
 const c=structuredClone(base),network='smtp_test_'+hash(project+credentialFile).slice(0,10);
 must(!c.networks?.[network],'SMTP_NETWORK_COLLISION');
 c.services.app.environment={...c.services.app.environment,MAIL_DELIVERY_MODE:'allowlist',TRANSACTIONAL_MAIL_ENABLED:'false',TEST_EMAIL_ALLOWLIST:approved.join(',')};
 Object.assign(c.services.auth.environment,gmailAuthSettings(undefined,{requirePassword:false}),{GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_MAILER_OTP_EXP:'3600',GOTRUE_RATE_LIMIT_EMAIL_SENT:'20'});
 c.services.auth.env_file=[{path:credentialFile,required:true}];
 const old=c.services.auth.networks;must(old&&typeof old==='object'&&!Array.isArray(old),'SMTP_RESOLVED_NETWORKS_REQUIRED');
 for(const n of Object.keys(old))must(c.networks?.[n]?.internal===true,'SMTP_EXISTING_AUTH_NETWORK_NOT_PRIVATE');
 c.services.auth.networks={...old,[network]:{gw_priority:1}};
 c.networks={...c.networks,[network]:{name:project+'_'+network,driver:'bridge',internal:false,enable_ipv6:false,labels:{'shadowbridge.purpose':'controlled-smtp-test'}}};
 return c;
}
export function assertSmtpCandidate(base,candidate,options){must(isDeepStrictEqual(candidate,smtpCandidate(base,options)),'SMTP_UNAPPROVED_COMPOSE_CHANGE');return true;}
async function privateFile(p){const s=await lstat(p);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600,'SMTP_PRIVATE_FILE_REQUIRED');return readFile(p);}
async function folder(p){
 const root=await realpath(repositoryRoot),base=path.join(root,'.local'),target=path.resolve(p);must(target.startsWith(base+'/smtp-package-')&&path.dirname(target)===base,'SMTP_PRIVATE_PACKAGE_PATH_REQUIRED');
 for(const v of [base,target]){const s=await lstat(v);must(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700,'SMTP_PRIVATE_DIRECTORY_REQUIRED');}return target;
}
async function json(p,v){await writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600,flag:'wx'});}
export async function prepareSmtpPackage({directory,base,emails,project}){
 const target=path.resolve(directory),parent=path.dirname(target),expected=path.join(await realpath(repositoryRoot),'.local');must(parent===expected&&path.basename(target).startsWith('smtp-package-'),'SMTP_PRIVATE_PACKAGE_PATH_REQUIRED');
 const p=await lstat(parent);must(p.isDirectory()&&!p.isSymbolicLink()&&(p.mode&0o777)===0o700,'SMTP_PRIVATE_DIRECTORY_REQUIRED');
 const options={emails:testRecipients(emails),project,credentialFile:path.join(target,'smtp-credential.env')},candidate=smtpCandidate(base,options);
 await mkdir(target,{mode:0o700});await folder(target);
 for(const [file,value]of [['baseline.compose.json',base],['candidate.compose.json',candidate]])await json(path.join(target,file),value);
 const manifest={kind:'shadowbridge-controlled-smtp-test-v1',baselineRelease:smtpBaseline,publicRegistration:false,credentialRequired:true,options,hashes:{}};
 for(const file of ['baseline.compose.json','candidate.compose.json'])manifest.hashes[file]=hash(await privateFile(path.join(target,file)));
 await json(path.join(target,'manifest.json'),manifest);return {directory:target,status:'PREPARED_CREDENTIAL_MISSING',publicRegistration:false};
}
export async function inspectSmtpPackage(directory,{sealed=false}={}){
 const root=await folder(directory),manifest=JSON.parse(await privateFile(path.join(root,'manifest.json')));
 must(manifest.kind==='shadowbridge-controlled-smtp-test-v1'&&manifest.baselineRelease===smtpBaseline&&manifest.publicRegistration===false,'SMTP_MANIFEST_REQUIRED');
 for(const name of ['baseline.compose.json','candidate.compose.json'])must(hash(await privateFile(path.join(root,name)))===manifest.hashes[name],'SMTP_FINGERPRINT_MISMATCH');
 must(manifest.options.credentialFile===path.join(root,'smtp-credential.env'),'SMTP_CREDENTIAL_PATH_CHANGED');
 const baseline=JSON.parse(await privateFile(path.join(root,'baseline.compose.json'))),candidate=JSON.parse(await privateFile(path.join(root,'candidate.compose.json')));assertSmtpCandidate(baseline,candidate,manifest.options);
 if(sealed){const receipt=JSON.parse(await privateFile(path.join(root,'seal.json'))),credential=await privateFile(manifest.options.credentialFile);must(receipt.manifestHash===hash(await privateFile(path.join(root,'manifest.json')))&&receipt.credentialHash===hash(credential),'SMTP_SEAL_MISMATCH');must(/^GOTRUE_SMTP_PASS=[A-Za-z0-9]{16}\n$/.test(credential.toString()),'SMTP_CREDENTIAL_FORMAT_REQUIRED');}
 return {root,manifest,baseline,candidate};
}
// No CLI asks for Gmail credentials in this stage. Tests pass freshly random fictional values.
export async function sealSmtpPackage(directory,credential){
 const {root,manifest}=await inspectSmtpPackage(directory),value=gmailAuthSettings(credential).GOTRUE_SMTP_PASS;
 await writeFile(manifest.options.credentialFile,'GOTRUE_SMTP_PASS='+value+'\n',{mode:0o600,flag:'wx'});
 await json(path.join(root,'seal.json'),{manifestHash:hash(await privateFile(path.join(root,'manifest.json'))),credentialHash:hash(await privateFile(manifest.options.credentialFile))});
 await inspectSmtpPackage(root,{sealed:true});return {sealed:true,publicRegistration:false};
}
export async function backupSmtpPackage(directory){
 const {root}=await inspectSmtpPackage(directory,{sealed:true}),files={};
 for(const name of ['baseline.compose.json','candidate.compose.json','manifest.json','seal.json','smtp-credential.env'])files[name]=(await privateFile(path.join(root,name))).toString('base64');
 const scratch=path.join(root,'configuration-'+randomUUID()+'.private.json');await json(scratch,{kind:'smtp-configuration-backup-v1',files});
 try{return await encryptArchive({archiveFile:scratch,backupFile:path.join(root,'configuration.sbb'),keyFile:path.join(root,'configuration.key')});}finally{await unlink(scratch);}
}
export async function verifySmtpBackup(directory,pair){
 const {root}=await inspectSmtpPackage(directory,{sealed:true});must(pair.backupFile===path.join(root,'configuration.sbb')&&pair.keyFile===path.join(root,'configuration.key'),'SMTP_BACKUP_PATH_REQUIRED');
 const scratch=path.join(root,'verify-'+randomUUID()+'.private.json');
 try{await decryptArchive({...pair,archiveFile:scratch});const data=JSON.parse(await privateFile(scratch));must(data.kind==='smtp-configuration-backup-v1'&&Object.keys(data.files||{}).sort().join(',')===['baseline.compose.json','candidate.compose.json','manifest.json','seal.json','smtp-credential.env'].sort().join(','),'SMTP_BACKUP_CONTENT_REQUIRED');
 for(const [name,value]of Object.entries(data.files))must(hash(Buffer.from(value,'base64'))===hash(await privateFile(path.join(root,name))),'SMTP_BACKUP_CONTENT_MISMATCH');return {authenticated:true,filesVerified:5};
 }finally{try{await unlink(scratch);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
export async function baselineFromSmtpBackup(directory,pair){
 await verifySmtpBackup(directory,pair);const {root}=await inspectSmtpPackage(directory,{sealed:true}),scratch=path.join(root,'rollback-'+randomUUID()+'.private.json');
 try{await decryptArchive({...pair,archiveFile:scratch});const b=JSON.parse(await privateFile(scratch));return JSON.parse(Buffer.from(b.files['baseline.compose.json'],'base64').toString());}finally{try{await unlink(scratch);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
export function smtpComposeApplyArguments(project,file){must(/^shadowbridge-[a-z0-9-]{3,80}$/.test(project)&&path.isAbsolute(file),'SMTP_COMPOSE_IDENTITY_REQUIRED');return['compose','--project-name',project,'-f',file,'up','-d','--no-build','--no-deps','--pull','never','--wait','--wait-timeout','120','app','auth'];}
export async function smtpConfigurationFlow(ops,phase){
 must(['backup','apply','rollback','verify'].includes(phase),'SMTP_INVALID_PHASE');let s=await ops.load();must(s&&s.baselineRelease===smtpBaseline&&s.publicRegistration===false,'SMTP_STATE_REQUIRED');
 await ops.checkImmutable(s);
 if(phase==='backup'){must(s.phase==='PREPARED','SMTP_PHASE_REQUIRED');await ops.assertBaseline(s);await ops.freshOwnerMfa();s.phase='BACKUPS_IN_PROGRESS';await ops.save(s);try{s.backups=await ops.backup(s);await ops.verifyBackups(s);}catch{throw Error('SMTP_BACKUP_INCOMPLETE_KEEP_CHECKPOINT_AND_ARTIFACTS');}s.phase='BACKUPS_VERIFIED_WAITING_OFFSITE';await ops.save(s);return s;}
 if(phase==='verify'){must(s.phase==='CONFIG_VERIFIED','SMTP_PHASE_REQUIRED');await ops.verifyCandidate(s);return s;}
 if(phase==='rollback'&&s.phase==='ROLLED_BACK_CONFIG_ONLY'){await ops.verifyBaseline(s);return s;}
 if(phase==='rollback'){must(['CONFIG_VERIFIED','APPLYING','ROLLED_BACK_CONFIG_ONLY'].includes(s.phase),'SMTP_PHASE_REQUIRED');await ops.rollback(s);await ops.verifyBaseline(s);s.phase='ROLLED_BACK_CONFIG_ONLY';await ops.save(s);return s;}
 must(s.phase==='BACKUPS_VERIFIED_WAITING_OFFSITE','SMTP_PHASE_REQUIRED');await ops.assertBaseline(s);await ops.verifyBackups(s);await ops.verifyOffsite(s);await ops.requireOwnerApproval(s);await ops.freshOwnerMfa();
 s.phase='APPLYING';await ops.save(s);
 try{await ops.apply(s);await ops.verifyCandidate(s);}catch{try{await ops.rollback(s);await ops.verifyBaseline(s);s.phase='ROLLED_BACK_CONFIG_ONLY';await ops.save(s);}catch{throw Error('SMTP_APPLY_FAILED_ROLLBACK_UNVERIFIED_KEEP_STATE');}throw Error('SMTP_APPLY_FAILED_ROLLED_BACK_KEEP_STATE');}
 s.phase='CONFIG_VERIFIED';await ops.save(s);return s;
}
