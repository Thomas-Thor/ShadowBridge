// Reconcile only the disposable test signup already confirmed in a browser.
// Never resend registration, change roles, reset MFA or update an Auth record.
export async function reconcileBrowserConfirmation(ops,state){
 if(state.phase!=='SIGNUP_MAIL_SENT')throw Error('SMTP_CONFIRMATION_CHECKPOINT_PHASE_REQUIRED');
 await ops.preflight();const account=await ops.inspectAccount();
 if(!account.unique||!account.disposable||account.staff)throw Error('SMTP_CONFIRMATION_TEST_ACCOUNT_NOT_PROVEN');
 if(!account.emailConfirmed)throw Error('SMTP_TEST_EMAIL_NOT_CONFIRMED_NO_REPLAY');
 if(ops.ownerReplayRejectionReported!==true)throw Error('SMTP_CONFIRMATION_BROWSER_REPLAY_EVIDENCE_REQUIRED');
 await ops.freshMfa();
 const login=await ops.login();
 if(login?.user?.id!==account.id||login.user.emailVerified!==true)throw Error('SMTP_CONFIRMATION_TEST_LOGIN_NOT_PROVEN');
 await ops.preserveOriginal();
 state.confirmationVerified=true;state.confirmationReplayRejected=true;
 state.confirmationEvidence='BROWSER_CONFIRMED_TEST_LOGIN_VERIFIED';
 state.confirmationReplayEvidence='OWNER_REPORTED_BROWSER_REPLAY_REJECTED';
 state.phase='CONFIRMED';await ops.save(state);return state;
}

export async function resumeBrowserConfirmation(sourceRelease,installerRelease,flow){
 const fs=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{createHash}=await import('node:crypto'),{pathToFileURL}=await import('node:url');
 const allowed=['cbca6a0c4ef9559081aaac7347370a774331b8ea','07cbcf6ea905eee89d80f66bf4a979f0252d5e17','a4e67c0f6c8c9832c26f7ac8e7a9d57e26108989','c1c94cc45e74535d712e0418c8749ed6bd618648','2e22ef0f755e18a73e2b0da9408b1cf54b529550'];
 const must=(v,c)=>{if(!v)throw Error(c);},hash=b=>createHash('sha256').update(b).digest('hex');let stage='confirmation.identity';
 const run=(bin,args)=>{try{return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:33554432}).trim();}catch(e){const error=Error('SMTP_CONFIRMATION_READ_COMMAND_FAILED');error.exitCode=Number.isInteger(e.status)?e.status:null;throw error;}};
 try{
  must(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','SMTP_TLS_VERIFICATION_REQUIRED');
  must(allowed.includes(sourceRelease)&&/^[a-f0-9]{40}$/.test(installerRelease),'SMTP_CONFIRMATION_OPERATOR_IDENTITY_REQUIRED');
  const root='/opt/shadowbridge-operators/smtp-'+sourceRelease,dir=root+'/.local/smtp-package-'+sourceRelease,file=dir+'/operator-state.json',lock='/opt/shadowbridge/.local/smtp-operator-lock';
  for(const p of [root,root+'/.local',dir,lock]){const st=await fs.lstat(p);must(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&511)===448&&st.uid===0&&await fs.realpath(p)===p,'SMTP_CONFIRMATION_PRIVATE_DIRECTORY_REQUIRED');}
  must(run('git',['-c','safe.directory='+root,'-C',root,'rev-parse','HEAD'])===sourceRelease&&!run('git',['-c','safe.directory='+root,'-C',root,'status','--porcelain']),'SMTP_CONFIRMATION_OPERATOR_IDENTITY_REQUIRED');
  const core=await import(pathToFileURL(root+'/scripts/smtp-operator-core.mjs').href),pkg=await import(pathToFileURL(root+'/scripts/smtp-test-package.mjs').href),old=await import(pathToFileURL(root+'/scripts/smtp-production-operator.mjs').href);
  return await core.operatorLock(lock,async()=>{
   const original=await core.privateRead(file),s=JSON.parse(original),fence=hash(original),origin='https://shadow-bridge.eu';let r,mfaTime=0;
   must(s.kind==='smtp-production-operator-v1'&&s.operatorRelease===sourceRelease&&s.baselineRelease==='80f4a0d333d31a6d57ada714b0df17bc0584a07b'&&s.dir===dir&&s.baseFile===dir+'/baseline.compose.json'&&s.publicRegistration===false,'SMTP_CONFIRMATION_CHECKPOINT_IDENTITY_REQUIRED');
   const docker=args=>run('docker',['--context','default',...args]);
   const query=q=>docker(['exec',r.pg.Id,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',"BEGIN READ ONLY;SET LOCAL statement_timeout='5s';"+q+';ROLLBACK;']);
   const cookies=new Map(s.test?.cookies||[]);let csrf=s.test?.csrf;const stagedTest={};
   const request=async(route,{method='GET',body,expected=200}={})=>{
    const headers={Accept:'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')};
    if(method==='POST'){headers.Origin=origin;headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;}
    const response=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
    for(const line of response.headers.getSetCookie()){const m=/^([^=;]+)=([^;]*)/.exec(line);if(m){if(m[2])cookies.set(m[1],m[2]);else cookies.delete(m[1]);}}
    const data=(response.headers.get('content-type')||'').includes('json')?await response.json():null;if(!data)await response.arrayBuffer();if(data?.csrfToken)csrf=data.csrfToken;
    if(response.status!==expected){const e=Error('SMTP_CONFIRMATION_HTTP_STATUS_UNEXPECTED');e.httpStatus=response.status;throw e;}
    stagedTest.cookies=[...cookies];stagedTest.csrf=csrf;return {status:response.status,data};
   };
   const ownerMfa=()=>Number(query("SELECT count(*) FROM sb.audit_events e JOIN sb.staff_role_assignments r ON r.user_id=e.actor_id JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND g.active AND a.status='active' AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND (r.expires_at IS NULL OR r.expires_at>now()) AND e.action='auth.mfa_verified' AND e.created_at>to_timestamp("+Math.floor(mfaTime/1000)+") AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=r.user_id AND f.factor_type='totp' AND f.status='verified')"))>0;
   const ops={
    preflight:async()=>{
     stage='confirmation.preflight';const p=await pkg.inspectSmtpPackage(dir,{sealed:true});r=await old.collectProduction({state:s});
     must(s.offsiteVerified===true&&s.transfer==='/home/shadowadmin/.shadowbridge-smtp-'+sourceRelease,'SMTP_CONFIRMATION_OFFSITE_NOT_PROVEN');core.verifyOffsiteReceipt(s.transferManifest,JSON.parse(await core.privateRead(s.transfer+'/offsite-receipt.json')),sourceRelease);
     for(const role of ['app','auth']){const c=r[role],env=Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));for(const[k,v]of Object.entries(p.candidate.services[role].environment))must(env[k]===String(v),'SMTP_CONFIRMATION_ALLOWLIST_RUNTIME_DRIFT');const networks=Object.keys(p.candidate.services[role].networks||{}).map(k=>p.candidate.networks[k].name||s.project+'_'+k).sort();must(JSON.stringify(Object.keys(c.NetworkSettings.Networks).sort())===JSON.stringify(networks),'SMTP_CONFIRMATION_NETWORK_DRIFT');}
     must(typeof s.test?.email==='string'&&p.manifest.options.emails.includes(s.test.email)&&typeof s.test.password==='string'&&s.test.password.length>=24&&s.outsideAllowlistRejected===true&&s.smtpAuthVerified===true,'SMTP_CONFIRMATION_TEST_CONTEXT_REQUIRED');
     const ids=s.userIds.map(id=>{must(/^[a-f0-9-]{36}$/.test(id),'SMTP_CONFIRMATION_USER_FINGERPRINT_REQUIRED');return"'"+id+"'::uuid";}).join(',')||'NULL';
     const fingerprint=hash(query("SELECT jsonb_build_object('users',(SELECT jsonb_agg(jsonb_build_object('id',id,'password',encrypted_password,'emailConfirmed',email_confirmed_at) ORDER BY id) FROM auth.users WHERE id IN("+ids+")),'accounts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM sb.accounts t WHERE user_id IN("+ids+")),'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,role_key) FROM sb.staff_role_assignments t WHERE user_id IN("+ids+")),'mfa',(SELECT jsonb_agg(to_jsonb(t)-'last_challenged_at'-'updated_at' ORDER BY id) FROM auth.mfa_factors t WHERE user_id IN("+ids+")))"));must(fingerprint===s.userFingerprint,'SMTP_CONFIRMATION_EXISTING_USERS_CHANGED');
    },
    inspectAccount:async()=>{stage='confirmation.account-read-only';const rows=JSON.parse(query("SELECT coalesce(json_agg(t),'[]') FROM (SELECT u.id,(u.email_confirmed_at IS NOT NULL) AS confirmed,EXISTS(SELECT 1 FROM sb.staff_role_assignments x WHERE x.user_id=u.id) OR EXISTS(SELECT 1 FROM sb.staff_grants x WHERE x.user_id=u.id) OR EXISTS(SELECT 1 FROM auth.mfa_factors x WHERE x.user_id=u.id) AS staff FROM auth.users u WHERE lower(u.email)='"+s.test.email.replaceAll("'","''")+"')t"));const a={unique:rows.length===1,id:rows[0]?.id,disposable:rows.length===1&&!s.userIds.includes(rows[0].id),staff:rows[0]?.staff===true,emailConfirmed:rows[0]?.confirmed===true};console.log(JSON.stringify({status:'SMTP_CONFIRMATION_READ_ONLY_EVIDENCE',phase:s.phase,accountUnique:a.unique,testAccount:a.disposable,staffAccount:a.staff,emailConfirmed:a.emailConfirmed,changesMade:false}));return a;},
    freshMfa:async()=>{stage='confirmation.owner-mfa';mfaTime=Date.now();await old.question('Potwierdź teraz OWNER TOTP w panelu i naciśnij Enter. Nie wpisuj kodu tutaj: ');must(ownerMfa(),'FRESH_OWNER_MFA_NOT_CONFIRMED');},
    // Explicit reconciliation mode records the OWNER's already completed
    // browser test. Do not pretend this is an automated token-replay test.
    ownerReplayRejectionReported:true,
    login:async()=>{stage='confirmation.test-login';await request('/api/config');return(await request('/api/auth/login',{method:'POST',body:{email:s.test.email,password:s.test.password}})).data;},
    preserveOriginal:async()=>{stage='confirmation.preserve-checkpoint';must(hash(await core.privateRead(file))===fence,'CHECKPOINT_CHANGED_DURING_RECOVERY');const archive=dir+'/state-before-confirmation-'+installerRelease+'-'+fence.slice(0,16)+'.json';try{await fs.writeFile(archive,original,{mode:384,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;must((await core.privateRead(archive)).equals(original),'SMTP_CONFIRMATION_HISTORY_CONFLICT');}},
    save:async state=>{stage='confirmation.checkpoint';must(Date.now()-mfaTime<300000&&ownerMfa(),'FRESH_OWNER_MFA_EXPIRED_BEFORE_SAVE');must(hash(await core.privateRead(file))===fence,'CHECKPOINT_CHANGED_DURING_RECOVERY');Object.assign(state.test,stagedTest);await core.atomicState(file,state);}
   };
   return flow(ops,s);
  });
 }catch(e){e.stage=stage;throw e;}
}
export function confirmationResumeCode(sourceRelease,installerRelease){
 if(!/^[a-f0-9]{40}$/.test(sourceRelease)||!/^[a-f0-9]{40}$/.test(installerRelease))throw Error('SMTP_CONFIRMATION_RELEASE_INVALID');
 return `import{hostname}from'node:os';try{if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_CONTABO_OPERATOR_REQUIRED');const s=await (${resumeBrowserConfirmation.toString()})(${JSON.stringify(sourceRelease)},${JSON.stringify(installerRelease)},${reconcileBrowserConfirmation.toString()});console.log(JSON.stringify({phase:s.phase,confirmationVerified:s.confirmationVerified===true,confirmationEvidence:s.confirmationEvidence,newRegistrationSent:false,servicesChanged:false}));}catch(e){console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z_]{4,120}$/.test(e.message||'')?e.message:'SMTP_CONFIRMATION_RECONCILIATION_FAILED',stage:e.stage||'confirmation.initialization',httpStatus:Number.isInteger(e.httpStatus)?e.httpStatus:null,checkpointRetained:true,noSuccessClaimed:true}));process.exitCode=1;}`;
}
