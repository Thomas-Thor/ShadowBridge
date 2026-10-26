import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,lstat} from 'node:fs/promises';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {missingSmtpStartSelection} from '../scripts/smtp-existing-checkpoint.mjs';
import {captureMissingSmtpProfile,normalizeMissingSmtpCredential,resumePreparedFlow,preparationResumeCode} from '../scripts/smtp-preparation-resume.mjs';
import {prepareSmtpPackage,sealSmtpPackage,inspectSmtpPackage,smtpCandidate} from '../scripts/smtp-test-package.mjs';
const source='cbca6a0c4ef9559081aaac7347370a774331b8ea';
function evidence(){return {candidates:[],lock:{exists:false},operatorInstalls:[{sourceRelease:source,reviewed:true,checkoutMatches:true,root:{type:'directory',mode:'700',uid:0},local:{type:'directory',mode:'700',uid:0},package:{exists:false},checkpoint:{exists:false},credentialFile:{exists:false},manifest:{exists:false}}]};}
test('explicit missing start selects only the original empty verified root; every uncertain artifact or lock refuses capture',()=>{
 assert.equal(missingSmtpStartSelection(evidence()).initializeEmpty,true);
 for(const change of [r=>r.lock.exists=true,r=>r.candidates.push({}),r=>r.operatorInstalls.push(r.operatorInstalls[0]),r=>r.operatorInstalls[0].reviewed=false,r=>r.operatorInstalls[0].root.uid=1000,r=>r.operatorInstalls[0].local.mode='755',r=>r.operatorInstalls[0].package.exists=true,r=>r.operatorInstalls[0].credentialFile.exists=null]){const r=evidence();change(r);assert.throws(()=>missingSmtpStartSelection(r));}
});
test('normalization handles grouped and bracketed-paste credentials; invalid input is classified without including its value',()=>{
 const c=randomBytes(8).toString('hex');assert.equal(normalizeMissingSmtpCredential(c),c);assert.equal(normalizeMissingSmtpCredential('\x1b[200~'+c.match(/.{4}/g).join(' ')+'\x1b[201~'),c);
 for(const [v,code] of [['BRAK','UNAVAILABLE'],['','EMPTY'],['private-fixture\nvalue','CONTROL_INPUT_REJECTED'],['not-a-valid-app-password','FORMAT_INVALID']])assert.throws(()=>normalizeMissingSmtpCredential(v),e=>e.message.includes(code)&&!e.message.includes(v||'impossible-value'));
});
test('real package library seals the supplied fictional credential once, with private permissions and no overwrites',async()=>{
 const tmp=await mkdtemp(path.resolve('.local/smtp-package-capture-unit-')),dir=tmp+'-profile',c=randomBytes(8).toString('hex'),origin='https://shadow-bridge.eu';
 const b={services:{app:{image:'sha256:'+'1'.repeat(64),environment:{APP_URL:origin,RELEASE_SHA:'80f4a0d333d31a6d57ada714b0df17bc0584a07b',MAIL_DELIVERY_MODE:'disabled',TRANSACTIONAL_MAIL_ENABLED:'false'}},auth:{image:'sha256:'+'2'.repeat(64),networks:{private:null},environment:{API_EXTERNAL_URL:origin,GOTRUE_SITE_URL:origin,GOTRUE_URI_ALLOW_LIST:origin+'/auth/confirm,'+origin+'/auth/recover',GOTRUE_MAILER_URLPATHS_CONFIRMATION:'/auth/confirm',GOTRUE_MAILER_URLPATHS_RECOVERY:'/auth/recover',GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_MFA_TOTP_VERIFY_ENABLED:'true'}},postgres:{}},networks:{private:{internal:true}}};
 const calls=[],ops={recipients:async()=>['fixture@example.invalid'],validate:async emails=>{smtpCandidate(b,{emails,project:'shadowbridge-fixture',credentialFile:dir+'/smtp-credential.env'});},credential:async()=>{calls.push('hidden-input');return '\x1b[200~'+c+'\x1b[201~';},assertAbsent:async()=>{await assert.rejects(lstat(dir),{code:'ENOENT'});},create:async emails=>{calls.push('create');await prepareSmtpPackage({directory:dir,base:b,emails,project:'shadowbridge-fixture'});},seal:async credential=>{calls.push('seal');await sealSmtpPackage(dir,credential);},verify:async()=>{calls.push('verify');await inspectSmtpPackage(dir,{sealed:true});}};
 await captureMissingSmtpProfile(ops,normalizeMissingSmtpCredential);assert.deepEqual(calls,['hidden-input','create','seal','verify']);
 assert.equal((await lstat(dir+'/smtp-credential.env')).mode&511,384);assert.equal((await lstat(dir)).mode&511,448);
 assert.equal((await readFile(dir+'/smtp-credential.env','utf8')),'GOTRUE_SMTP_PASS='+c+'\n');assert.ok(!(await readFile(dir+'/manifest.json','utf8')).includes(c));
 const before=await readFile(dir+'/smtp-credential.env');await assert.rejects(sealSmtpPackage(dir,randomBytes(8).toString('hex')),{code:'EEXIST'});assert.deepEqual(await readFile(dir+'/smtp-credential.env'),before);
});
test('invalid input or an intervening artifact cannot create or overwrite a profile',async()=>{
 for(const raced of [false,true]){const calls=[],ops={recipients:async()=>[],validate:async()=>{},credential:async()=>raced?randomBytes(8).toString('hex'):'BRAK',assertAbsent:async()=>{throw Error('EXISTING_SMTP_ARTIFACTS_USE_RESUME_NOT_START');},create:async()=>calls.push('create'),seal:async()=>calls.push('seal'),verify:async()=>calls.push('verify')};await assert.rejects(captureMissingSmtpProfile(ops,normalizeMissingSmtpCredential));assert.deepEqual(calls,[]);}
});
test('fresh MFA precedes capture and every backup; denied MFA leaves all input, state and artifacts untouched',async()=>{
 for(const denied of [false,true]){const calls=[],ops={preflight:async()=>{},planBackups:async()=>({}),freshMfa:async()=>{calls.push('mfa');if(denied)throw Error('FRESH_OWNER_MFA_NOT_CONFIRMED');},initializeProfile:async()=>calls.push('capture'),archiveOriginal:async()=>calls.push('archive'),save:async()=>calls.push('save'),createBackup:async n=>{calls.push('backup:'+n);return{};},transfer:async()=>calls.push('transfer')};const s={phase:'NO_CHECKPOINT'};
 if(denied){await assert.rejects(resumePreparedFlow(ops,s));assert.deepEqual(calls,['mfa']);assert.equal(s.phase,'NO_CHECKPOINT');}else{await resumePreparedFlow(ops,s);assert.ok(calls.indexOf('mfa')<calls.indexOf('capture'));assert.ok(calls.indexOf('capture')<calls.indexOf('backup:database'));assert.equal(s.phase,'WAITING_REAL_OFFSITE');}}
 assert.ok(preparationResumeCode(source,'a'.repeat(40),{initializeEmpty:true}).includes('setup.credential-input'));
});
