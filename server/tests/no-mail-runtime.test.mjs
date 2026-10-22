// Narrow HTTP/UI unit regression. Database and provider are deliberately
// instrumented stubs: these results do not claim a real PostgreSQL deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadConfig } from '../config.mjs';
import { createApp } from '../app.mjs';

function environment(mode='disabled') {
  const key=randomBytes(32).toString('hex');
  return { APP_ENV:'production',APP_URL:'https://shadowbridge.invalid',
    SUPABASE_URL:'https://auth.shadowbridge.invalid',SUPABASE_ANON_KEY:randomBytes(32).toString('hex'),
    DATABASE_URL:`postgres://shadowbridge_api:${key}@postgres/shadowbridge?sslmode=verify-full`,
    SESSION_DATABASE_URL:`postgres://shadowbridge_sessions:${key}@postgres/shadowbridge?sslmode=verify-full`,
    SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),MAIL_DELIVERY_MODE:mode };
}

test('disabled mail advertises closed onboarding; captured and explicit SMTP remain compatible',()=>{
  for(const mode of ['disabled','captured','smtp']){
    const config=loadConfig({...environment(mode),...(mode==='smtp'?{TRANSACTIONAL_MAIL_ENABLED:'true'}:{})});
    for(const key of ['registrationEnabled','passwordRecoveryEnabled','emailVerificationEnabled'])assert.equal(config[key],mode!=='disabled');
  }
});

test('no-mail HTTP rejects every email path before provider or database access, preserving login and contact',async t=>{
  const config=loadConfig(environment());
  let dbCalls=0,providerCalls=0;
  const noQuery=()=>{dbCalls++;throw new Error('Unexpected database access');};
  const db={sessionPool:{query:async(sql)=>{if(sql.includes('sb.enqueue_contact')){dbCalls++;return {rows:[{receipt:'FICTIONAL-RECEIPT'}]};}return noQuery();}},close:async()=>{}};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    if(String(input).startsWith(config.supabaseUrl)){providerCalls++;return new Response('{}',{status:401,headers:{'Content-Type':'application/json'}});}
    return originalFetch(input,options);
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  const app=createApp({config,db});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const first=await originalFetch(base+'/api/config');
  const cookie=first.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const data=await first.json();
  assert.deepEqual(data.capabilities,{registration:false,passwordRecovery:false,emailVerification:false});
  const headers={Origin:config.appUrl,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':data.csrfToken};
  for(const route of ['/api/auth/register','/api/auth/recover','/api/auth/resend-verification','/api/auth/password']){
    const response=await originalFetch(base+route,{method:'POST',headers,body:'{}'});
    assert.equal(response.status,503);assert.equal((await response.json()).code,'MAIL_NOT_ENABLED');
  }
  for(const route of ['/auth/confirm?token=fictional','/auth/recover?token=fictional']){
    const response=await originalFetch(base+route);assert.equal(response.status,503);assert.equal((await response.json()).code,'MAIL_NOT_ENABLED');
  }
  assert.equal(dbCalls,0);assert.equal(providerCalls,0);
  const login=await originalFetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({email:'fictional@test.shadowbridge.invalid',password:'fictional-input'})});
  assert.equal(login.status,401);assert.equal(providerCalls,1,'Login still reaches the identity provider');assert.equal(dbCalls,0);
  const mfa=await originalFetch(base+'/api/auth/mfa/verify',{method:'POST',headers,body:'{}'});
  assert.equal(mfa.status,401,'MFA remains authentication protected, not disabled by mail mode');
  const contact=await originalFetch(base+'/api/contact',{method:'POST',headers,body:JSON.stringify({name:'Fictional Test',email:'fictional@test.shadowbridge.invalid',company:'Fictional',role:'other',message:'Fictional non-confidential controlled queue message.',consent:true,website:''})});
  assert.equal(contact.status,201);assert.equal((await contact.json()).accepted,true);assert.equal(dbCalls,1);
});

test('account UI keeps sign-in enabled and disables registration/recovery without sending requests',async()=>{
  const makeForm=kind=>({dataset:{accountForm:kind},hidden:false,fieldset:{disabled:true},button:{disabled:true},listeners:{},querySelector(selector){return selector==='fieldset'?this.fieldset:this.button;},addEventListener(name,handler){this.listeners[name]=handler;},reportValidity(){return false;}});
  const forms=['login','password','recover','register'].map(makeForm),notice={replaceChildren(){},append(){},classList:{toggle(){}},scrollIntoView(){}},description={textContent:''};
  const requests=[];
  const document={hidden:false,querySelectorAll(){return forms;},querySelector(selector){return ({'#application-status, #sign-in-status':notice,'#sign-in-form':forms[0],'#password-form':forms[1],'#account-recovery > p':description})[selector]||null;},createElement(){return {textContent:''};},addEventListener(){}};
  const context={document,window:{addEventListener(){},setInterval(){}},location:{search:'?recovery=1'},URLSearchParams,AbortController,fetch:async url=>{
    requests.push(url);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({backendEnabled:true,environment:'production',csrfToken:'fictional-csrf',capabilities:{registration:false,passwordRecovery:false,emailVerification:false}})};
  }};
  vm.runInNewContext(await readFile(new URL('../../assets/account.js',import.meta.url),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(forms[0].fieldset.disabled,false);assert.equal(forms[0].button.disabled,false);assert.equal(forms[0].hidden,false);
  assert.equal(forms[1].hidden,true);
  for(const form of forms.slice(1)){assert.equal(form.fieldset.disabled,true);assert.equal(form.button.disabled,true);await form.listeners.submit({preventDefault(){}});}
  assert.match(description.textContent,/temporarily unavailable/);
  assert.deepEqual(requests,['/api/config']);
});
