import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,chmod} from 'node:fs/promises';
import path from 'node:path';
import {inspectExistingSmtp,existingResumeSelection,existingSmtpDiscoveryCode} from '../scripts/smtp-existing-checkpoint.mjs';

const source='cbca6a0c4ef9559081aaac7347370a774331b8ea';
async function emptyInstall(release=source){
 const root=await mkdtemp(path.resolve('.local/smtp-empty-unit-'));
 const operatorRoot=root+'/operators',liveRoot=root+'/live',checkout=operatorRoot+'/smtp-'+release;
 await mkdir(checkout+'/.local',{recursive:true,mode:0o700});
 return {operatorRoot,liveRoot,checkout,readCommand:(bin,args)=>bin==='git'?(args.includes('rev-parse')?release:''):args.includes('ps')?'':'[]'};
}

test('empty code-only install is reported, not mistaken for a saved credential, and normal resume never probes or starts prepare',async()=>{
 const f=await emptyInstall();let probes=0;
 const r=await inspectExistingSmtp({...f,validateEmptyPreparation:async()=>{probes++;}});
 assert.equal(r.candidates.length,0);assert.equal(r.operatorInstalls.length,1);
 assert.equal(r.operatorInstalls[0].package.exists,false);assert.equal(r.operatorInstalls[0].credentialFile.exists,false);
 assert.throws(()=>existingResumeSelection(r),/NO_SAVED_SMTP_ATTEMPT_FOUND/);assert.equal(probes,0);
});

test('explicit read-only empty diagnostic reports the exact safe candidate failure, creates no package and does not prompt for a password',async()=>{
 const f=await emptyInstall(),before=await readdir(f.checkout+'/.local');let probes=0;
 const r=await inspectExistingSmtp({...f,diagnoseEmpty:true,validateEmptyPreparation:async(root,release)=>{
  probes++;assert.equal(root,f.checkout);assert.equal(release,source);
  const e=Error('SMTP_APPROVED_EMAIL_PATHS_REQUIRED');e.safePreparationStage='preparation.candidate';throw e;
 }});
 assert.equal(probes,1);assert.equal(r.prePackageCheck.reason,'SMTP_APPROVED_EMAIL_PATHS_REQUIRED');
 assert.equal(r.prePackageCheck.stage,'preparation.candidate');assert.equal(r.prePackageCheck.credentialRead,false);
 assert.deepEqual(await readdir(f.checkout+'/.local'),before);assert.equal(r.changesMade,false);
});

test('successful in-memory shape probe cannot be reported as a recovered password or historical diagnosis',async()=>{
 const f=await emptyInstall();
 const r=await inspectExistingSmtp({...f,diagnoseEmpty:true,validateEmptyPreparation:async()=>{}});
 assert.equal(r.prePackageCheck.status,'PASS');assert.equal(r.prePackageCheck.reason,'NO_SAVED_PROFILE_HISTORICAL_INPUT_OR_FAILURE_NOT_RECOVERABLE');
 assert.equal(r.prePackageCheck.profileWritten,false);assert.equal(r.codeSent,false);assert.equal(r.candidates.length,0);
 assert.throws(()=>existingResumeSelection(r),/NO_SAVED_SMTP_ATTEMPT_FOUND/);
});

test('unsafe parent, unreviewed source, multiple empty installs and raw failures do not run unsafe code or disclose exception details',async()=>{
 const f=await emptyInstall();let probes=0;const probe=async()=>{probes++;throw Error('private-value@example.invalid secret');};
 await chmod(f.checkout+'/.local',0o755);
 let r=await inspectExistingSmtp({...f,diagnoseEmpty:true,validateEmptyPreparation:probe});
 assert.equal(r.prePackageCheck.reason,'SMTP_PRIVATE_DIRECTORY_REQUIRED');assert.equal(probes,0);
 await chmod(f.checkout+'/.local',0o700);
 r=await inspectExistingSmtp({...f,diagnoseEmpty:true,validateEmptyPreparation:probe});
 assert.equal(r.prePackageCheck.reason,'READ_ONLY_PREPARATION_CHECK_FAILED');assert.ok(!JSON.stringify(r).includes('private-value'));
 const u=await emptyInstall('a'.repeat(40));probes=0;
 r=await inspectExistingSmtp({...u,diagnoseEmpty:true,validateEmptyPreparation:probe});assert.equal(probes,0);
 const other='07cbcf6ea905eee89d80f66bf4a979f0252d5e17';
 await mkdir(f.operatorRoot+'/smtp-'+other+'/.local',{recursive:true,mode:0o700});
 r=await inspectExistingSmtp({...f,diagnoseEmpty:true,readCommand:(bin,args)=>bin==='git'?(args.includes('rev-parse')?args[args.indexOf('-C')+1].slice(-40):''):args.includes('ps')?'':'[]',validateEmptyPreparation:probe});
 assert.equal(r.prePackageCheck.reason,'UNIQUE_REVIEWED_EMPTY_OPERATOR_REQUIRED');assert.equal(probes,0);
});

test('an empty or backup-only package is retained for review and cannot trigger a new preparation or empty probe',async()=>{
 const f=await emptyInstall(),pkg=f.checkout+'/.local/smtp-package-'+source;await mkdir(pkg,{mode:0o700});
 for(const withBackup of [false,true]){
  if(withBackup)await writeFile(pkg+'/database.sbb','FICTIONAL_ARCHIVE',{mode:0o600});
  let probes=0;const r=await inspectExistingSmtp({...f,diagnoseEmpty:true,validateEmptyPreparation:async()=>{probes++;}});
  assert.equal(probes,0);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].credentialSaved,false);
  assert.throws(()=>existingResumeSelection(r),/SAVED_SMTP_CREDENTIAL_OR_SEAL_NOT_PROVEN/);
  assert.deepEqual(await readdir(pkg),withBackup?['database.sbb']:[]);
 }
 assert.ok(existingSmtpDiscoveryCode({diagnoseEmpty:true}).includes('diagnoseEmpty:true'));
 assert.ok(existingSmtpDiscoveryCode().includes('diagnoseEmpty:false'));
});

test('default diagnostic imports the pinned fixture modules and runs the real candidate validator only in memory',async()=>{
 const f=await emptyInstall();await mkdir(f.checkout+'/scripts',{mode:0o700});
 await writeFile(f.checkout+'/scripts/smtp-production-operator.mjs',`export async function collectProduction(){return {project:'shadowbridge-fixture',base:{services:{app:{image:'sha256:'+ '1'.repeat(64),environment:{RELEASE_SHA:'80f4a0d333d31a6d57ada714b0df17bc0584a07b',MAIL_DELIVERY_MODE:'disabled',TRANSACTIONAL_MAIL_ENABLED:'false'}},auth:{image:'sha256:'+'2'.repeat(64),environment:{GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_MFA_TOTP_VERIFY_ENABLED:'true'}},postgres:{}}}};}`);
 await writeFile(f.checkout+'/scripts/smtp-test-package.mjs','export {smtpCandidate} from '+JSON.stringify(new URL('../scripts/smtp-test-package.mjs',import.meta.url).href)+';');
 const before=await readdir(f.checkout+'/.local');
 const r=await inspectExistingSmtp({...f,diagnoseEmpty:true});
 assert.equal(r.prePackageCheck.reason,'SMTP_APPROVED_EMAIL_PATHS_REQUIRED');assert.equal(r.prePackageCheck.stage,'preparation.candidate');
 assert.deepEqual(await readdir(f.checkout+'/.local'),before);assert.equal(r.prePackageCheck.credentialRead,false);
});
