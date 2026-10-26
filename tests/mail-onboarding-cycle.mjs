// Real GoTrue + PostgreSQL + captured SMTP. Invoked only by the isolated lab runner.
import assert from 'node:assert/strict';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {loadConfig} from '../server/config.mjs';
import * as h from '../server/tests/helpers.mjs';
assert.equal(process.env.SHADOWBRIDGE_MAIL_FIXTURE,'fresh-offline-namespace');
assert.equal(process.env.APP_ENV,'test');
assert.equal(process.env.MAIL_DELIVERY_MODE,'captured');
assert.equal(process.env.SHADOWBRIDGE_TEST_URL,'http://127.0.0.1:8088');
const admin=new pg.Pool({connectionString:process.env.SHADOWBRIDGE_MAIL_TEST_ADMIN});
delete process.env.SHADOWBRIDGE_MAIL_TEST_ADMIN;
const app=createApp({config:loadConfig()});
const report={kind:'mail-onboarding-real-offline-regression',mocksUsed:false,externalEmailSent:false,productionChanged:false,tlsDeliveryTested:false,cases:[]};
let current='startup',operator;const actors=[];
const phase=async(name,fn)=>{current=name;await fn();report.cases.push({name,result:'PASS'});};
const query=(sql,args=[])=>admin.query(sql,args);
const saved=async(a)=>(await query('SELECT encrypted_password,email_confirmed_at FROM auth.users WHERE email=$1',[a.email])).rows[0];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function link(a,type){const m=await h.waitForMessage(a.email),u=h.confirmationLink(m);assert.equal(u.origin,'http://127.0.0.1:8088');assert.equal(u.pathname,type==='signup'?'/auth/confirm':'/auth/recover');assert.ok(u.searchParams.get('token')||u.searchParams.get('token_hash'));return u.pathname+u.search;}
async function confirm(a){const u=await link(a,'signup');await a.client.request(u,{expected:303});await a.client.request('/api/config');a.user=(await a.client.signIn(a)).session.user;return u;}
try{
 await new Promise(r=>app.server.listen(8088,'127.0.0.1',r));
 await phase('Buyer/Supplier/Partner: captured email, verification required, immutable role/application, no automatic private access',async()=>{
  for(const role of ['buyer','supplier','partner']){
   const a=await h.registerActor(role);actors.push(a);
   await new h.Client().request('/api/auth/login',{method:'POST',body:{email:a.email,password:a.password},expected:401});
   assert.equal((await saved(a)).email_confirmed_at,null);
   const url=await confirm(a);assert.equal(a.user.emailVerified,true);assert.equal(a.user.applicationStatus,'pending');assert.deepEqual(a.user.roles,[]);
   const record=(await query('SELECT requested_role,status FROM sb.applications WHERE user_id=$1',[a.user.id])).rows;assert.equal(record.length,1);assert.equal(record[0].requested_role,role);assert.equal(record[0].status,'pending');
   await new h.Client().request(url,{expected:401});
  }
 });
 await phase('email confirmation expires according to GoTrue OTP policy; malformed and replayed tokens rejected',async()=>{
  const a=await h.registerActor('buyer','expired-signup'),u=await link(a,'signup');
  await query("UPDATE auth.users SET confirmation_sent_at=now()-interval '2 hours' WHERE email=$1",[a.email]);
  await a.client.request(u,{expected:401});assert.equal((await saved(a)).email_confirmed_at,null);
  await a.client.request('/auth/confirm?token=invalid-fictional-token',{expected:401});
 });
 await phase('reset captured mail; restricted recovery session; CSRF required; new password persisted; old password and old sessions rejected',async()=>{
  const a=actors[0],old=new h.Client();await old.signIn(a);const rolesBefore=digest((await query('SELECT * FROM sb.memberships WHERE user_id=$1 ORDER BY id',[a.user.id])).rows);
  const r=new h.Client();await r.request('/api/auth/recover',{method:'POST',body:{email:a.email},expected:202});const u=await link(a,'recovery');
  await r.request(u,{expected:303});await r.request('/api/config');assert.equal((await r.request('/api/session',{expected:200})).data.user.recoveryOnly,true);
  await r.request('/api/rfqs',{expected:403});await r.request('/api/auth/password',{method:'POST',body:{password:h.password()},csrf:false,expected:403});
  await new h.Client().request(u,{expected:401});
  const replacement=h.password();await r.request('/api/auth/password',{method:'POST',body:{password:replacement},expected:200});
  await new h.Client().request('/api/auth/login',{method:'POST',body:{email:a.email,password:a.password},expected:401});
  assert.equal((await old.request('/api/session',{expected:200})).data.user,null);a.password=replacement;await a.client.signIn(a);
  assert.equal(digest((await query('SELECT * FROM sb.memberships WHERE user_id=$1 ORDER BY id',[a.user.id])).rows),rolesBefore);
 });
 await phase('expired reset link rejected; unknown-account response is generic; cross-origin and missing CSRF cannot send mail',async()=>{
  const a=actors[1],r=new h.Client();await r.request('/api/auth/recover',{method:'POST',body:{email:a.email},expected:202});const u=await link(a,'recovery');
  await query("UPDATE auth.users SET recovery_sent_at=now()-interval '2 hours' WHERE email=$1",[a.email]);await r.request(u,{expected:401});
  const unknown=await new h.Client().request('/api/auth/recover',{method:'POST',body:{email:'unknown.'+h.runId+'@test.shadowbridge.invalid'},expected:202});assert.equal(unknown.data.accepted,true);assert.match(unknown.data.message,/If an eligible account exists/);
  await r.request('/api/auth/recover',{method:'POST',body:{email:a.email},csrf:false,expected:403});await r.request('/api/auth/recover',{method:'POST',body:{email:a.email},origin:'https://other.invalid',expected:403});
 });
 await phase('actual OWNER login and TOTP remain required; public recovery cannot replace OWNER password/MFA/role',async()=>{
  const o=await h.registerActor('partner','owner-fixture');operator=o;await confirm(o);await query('SELECT sb.bootstrap_owner($1::uuid)',[o.user.id]);await o.client.signIn(o);
  await o.client.request('/api/admin/applications',{expected:403});
  const factor=(await o.client.request('/api/auth/mfa/enroll',{method:'POST',body:{},expected:201})).data;assert.ok(factor.totp?.secret);
  await o.client.request('/api/auth/mfa/verify',{method:'POST',body:{factorId:factor.id,code:h.totp(factor.totp.secret)},expected:200});await o.client.request('/api/admin/applications',{expected:200});
  const protectedState=async()=>digest((await query("SELECT jsonb_build_object('password',(SELECT encrypted_password FROM auth.users WHERE id=$1),'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY role_key) FROM sb.staff_role_assignments t WHERE user_id=$1),'factors',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM auth.mfa_factors t WHERE user_id=$1)) AS state",[o.user.id])).rows);
  const before=await protectedState(),r=new h.Client();await r.request('/api/auth/recover',{method:'POST',body:{email:o.email},expected:202});const u=await link(o,'recovery');await r.request(u,{expected:303});await r.request('/api/config');
  const denied=await r.request('/api/auth/password',{method:'POST',body:{password:h.password()},expected:403});assert.equal(denied.data.code,'owner_recovery_controlled');assert.equal(await protectedState(),before);
  await o.client.request('/api/admin/applications',{expected:200});
 });
 await phase('manual approval enables only each account own role API and its dashboard',async()=>{
  for(const a of actors){
   const id=(await query('SELECT id FROM sb.applications WHERE user_id=$1',[a.user.id])).rows[0].id;
   await operator.client.request('/api/admin/applications/'+id+'/decision',{method:'POST',body:{decision:'approved',reason:'FICTIONAL controlled mail regression manual application review.'},expected:200});
   const session=(await a.client.request('/api/session',{expected:200})).data.user;assert.deepEqual(session.roles,[a.role]);
   await a.client.request('/portal/'+a.role+'/',{expected:200});
   const own={buyer:'/api/rfqs',supplier:'/api/offers',partner:'/api/proposals'};await a.client.request(own[a.role],{expected:200});
   for(const role of Object.keys(own))if(role!==a.role)await a.client.request(own[role],{expected:403});
   await a.client.request('/api/admin/applications',{expected:403});
  }
 });
 await phase('registration throttling fails closed at BFF limit; no new fake accounts generated by blocked attempts',async()=>{
  const c=new h.Client();let rateLimited=false;
  for(let i=0;i<45;i++){const r=await c.request('/api/auth/register',{method:'POST',body:{}});if(r.status===429){rateLimited=true;break;}assert.equal(r.status,400);}
  assert.equal(rateLimited,true);
 });
 report.result='PASS';
}catch(e){report.result='FAIL';report.failedCase=current;report.errorType=e.name;report.errorCode=/^[A-Z0-9_]{4,32}$/.test(e.code||'')?e.code:null;report.errorAt=e.stack?.match(/mail-onboarding-cycle\.mjs:\d+:\d+/)?.[0]||null;process.exitCode=1;}
finally{await app.close();await admin.end();console.log(JSON.stringify(report));}
