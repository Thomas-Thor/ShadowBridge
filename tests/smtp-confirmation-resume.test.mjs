import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {reconcileBrowserConfirmation,confirmationResumeCode} from '../scripts/smtp-confirmation-resume.mjs';
import {externalFailure} from '../scripts/smtp-launcher-execution.mjs';
function fixture(){const calls=[],state={phase:'SIGNUP_MAIL_SENT',test:{email:'fixture@example.invalid'},outsideAllowlistRejected:true},account={id:'fictional-test-id',unique:true,disposable:true,staff:false,emailConfirmed:true};
 const ops={preflight:async()=>calls.push('preflight'),inspectAccount:async()=>{calls.push('read-account');return account;},freshMfa:async()=>calls.push('owner-mfa'),ownerReplayRejectionReported:true,login:async()=>{calls.push('login');return{user:{id:account.id,emailVerified:true,status:'pending'}};},preserveOriginal:async()=>calls.push('preserve'),save:async()=>calls.push('save')};return{ops,calls,state,account};}
test('browser activation and OWNER-reported one-use test are reconciled without another link click',async()=>{
 const f=fixture();await reconcileBrowserConfirmation(f.ops,f.state);assert.deepEqual(f.calls,['preflight','read-account','owner-mfa','login','preserve','save']);
 assert.equal(f.state.phase,'CONFIRMED');assert.equal(f.state.confirmationVerified,true);assert.equal(f.state.confirmationReplayRejected,true);assert.equal(f.state.test.email,'fixture@example.invalid');assert.equal(f.state.confirmationReplayEvidence,'OWNER_REPORTED_BROWSER_REPLAY_REJECTED');
 assert.ok(!f.calls.some(c=>/register|resend|reset|apply|role|delete/.test(c)));
});
test('unconfirmed, ambiguous, pre-existing or staff accounts stop with no writes, prompts or replay',async()=>{
 for(const change of [a=>a.emailConfirmed=false,a=>a.unique=false,a=>a.disposable=false,a=>a.staff=true]){const f=fixture(),before=JSON.stringify(f.state);change(f.account);await assert.rejects(reconcileBrowserConfirmation(f.ops,f.state));assert.equal(JSON.stringify(f.state),before);assert.deepEqual(f.calls,['preflight','read-account']);}
});
test('missing browser evidence, MFA denial or a wrong test identity preserves the original checkpoint',async()=>{
 for(const fail of ['mfa','evidence','login-id','login-unverified']){const f=fixture(),before=JSON.stringify(f.state);
  if(fail==='mfa')f.ops.freshMfa=async()=>{throw Error('FRESH_OWNER_MFA_NOT_CONFIRMED');};
  if(fail==='evidence')f.ops.ownerReplayRejectionReported=false;
  if(fail==='login-id')f.ops.login=async()=>({user:{id:'another-id',emailVerified:true}});
  if(fail==='login-unverified')f.ops.login=async()=>({user:{id:f.account.id,emailVerified:false}});
  await assert.rejects(reconcileBrowserConfirmation(f.ops,f.state));assert.equal(JSON.stringify(f.state),before);assert.ok(!f.calls.includes('save'));assert.ok(!f.calls.includes('preserve'));
 }
});
test('only SIGNUP_MAIL_SENT can reconcile; it never advances an uncertain registration or reset',async()=>{
 for(const phase of ['PREPARED','SIGNUP_REQUEST_IN_PROGRESS','PASSWORD_RESET_IN_PROGRESS','CONFIRMED']){const f=fixture();f.state.phase=phase;await assert.rejects(reconcileBrowserConfirmation(f.ops,f.state),/CHECKPOINT_PHASE_REQUIRED/);assert.deepEqual(f.calls,[]);}
});
test('real local HTTP fixture verifies test login with no replay, registration or resend',async()=>{
 const requests=[],server=createServer(async(req,res)=>{requests.push(req.url);res.setHeader('Content-Type','application/json');
  if(req.url==='/api/auth/login'){for await(const _ of req){};res.end(JSON.stringify({user:{id:'fictional-test-id',emailVerified:true}}));}
  else{res.writeHead(500);res.end('{}');}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const origin='http://127.0.0.1:'+server.address().port,f=fixture();
  f.ops.login=async()=>await(await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'fixture@example.invalid',password:'FICTIONAL_TEST_ONLY'})})).json();
  await reconcileBrowserConfirmation(f.ops,f.state);assert.equal(f.state.phase,'CONFIRMED');assert.deepEqual(requests,['/api/auth/login']);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('generated remote code pins both releases and exposes only safe status/phase fields',()=>{
 assert.throws(()=>confirmationResumeCode('main','a'.repeat(40)));
 const code=confirmationResumeCode('cbca6a0c4ef9559081aaac7347370a774331b8ea','a'.repeat(40));assert.ok(code.includes('confirmation.account-read-only'));assert.ok(code.includes('confirmation.test-login'));
 assert.ok(!code.includes('UPDATE auth.users'));assert.ok(!code.includes("'/api/auth/register'"));assert.ok(!code.includes("'/api/auth/recover'"));assert.ok(!code.includes('console.log(JSON.stringify(s))'));
});
test('transport forwards safe HTTP status and original onboarding code without response bodies or tokens',()=>{
 for(const reason of ['SMTP_CONFIRMATION_HTTP_STATUS_UNEXPECTED','REAL_ONBOARDING_REQUEST_FAILED']){const r=externalFailure({exitCode:1,stderr:JSON.stringify({status:'BLOCKED',reason,stage:'confirmation.test-login',httpStatus:403,token:'FICTIONAL_PRIVATE_TOKEN',body:'PRIVATE_RESPONSE'})},{stage:'operator.reconcile-confirmation',command:'ssh'});assert.equal(r.remoteCode,reason);assert.equal(r.remoteHttpStatus,403);assert.ok(!JSON.stringify(r).includes('FICTIONAL_PRIVATE_TOKEN'));assert.ok(!JSON.stringify(r).includes('PRIVATE_RESPONSE'));}
});
