// HOST ONLY: controlled recovery of an EXISTING verified OWNER. No public
// endpoint, email, account creation, role grant or MFA removal is implemented.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { open,rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging,readEnv,repositoryRoot } from './staging-prepare.mjs';
import { backupInstallation,composeArguments } from './staging-ops.mjs';

const guard=(ok,message)=>{if(!ok)throw new Error(message);};
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export function passwordPayload(password) {
  guard(typeof password==='string' && password.length>=16 && password.length<=128 && !/[\r\n\0]/.test(password),'Nowe hasło musi mieć 16–128 znaków bez znaków sterujących.');
  return {password};
}
export function recoveryIdentity({email,incident}) {
  guard(typeof email==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length<=254,'Podaj istniejący, potwierdzony adres OWNER.');
  guard(typeof incident==='string' && incident.trim().length>=10 && incident.length<=200 && !/[\x00-\x1f\x7f]/.test(incident),'Wymagany numer/opis incydentu: 10–200 znaków bez danych uwierzytelniających.');
  return {email:email.trim().toLowerCase(),incident:incident.trim()};
}
export function recoveryToken(secret,now=Math.floor(Date.now()/1000)) {
  guard(typeof secret==='string' && secret.length>=32 && Number.isInteger(now),'Niepoprawna konfiguracja administracyjnego Auth.');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',aud:'authenticated',iat:now,exp:now+60});
  return unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
}
// Credentials are supplied exclusively over stdin, not shell arguments/env.
export const adminPasswordRunner=`let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)process.exit(1);}const p=JSON.parse(input);if(p.provider!=='https://auth-proxy:8444'||!/^[a-f0-9-]{36}$/i.test(p.id))process.exit(1);let ready=false;const deadline=Date.now()+15000;while(Date.now()<deadline){try{const h=await fetch(p.provider+'/auth/v1/health',{signal:AbortSignal.timeout(1000)});await h.arrayBuffer();if(h.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)process.exit(1);const r=await fetch(p.provider+'/auth/v1/admin/users/'+p.id,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+p.token,apikey:p.token,'Content-Type':'application/json'},body:JSON.stringify({password:p.password})});await r.arrayBuffer();if(!r.ok)process.exit(1);process.stdout.write('OK');`;

export async function recoverOwnerPassword({directory,email,incident,password}={}) {
  ({email,incident}=recoveryIdentity({email,incident}));passwordPayload(password);
  const checked=await checkStaging({directory});directory=checked.directory;
  const env={...process.env,...await readEnv(path.join(directory,'compose.env'))};
  const run=(args,input)=>{try{return execFileSync('docker',composeArguments(directory,args),{cwd:repositoryRoot,env,encoding:'utf8',input,stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],maxBuffer:1024*1024}).trim();}catch{throw new Error('Operacja odzyskiwania nie zakończyła się poprawnie. Zachowano backup i MFA; sprawdź prywatny audyt. Nie publikuj surowych logów.');}};
  const sql=query=>run(['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge'],query);
  const lock=path.join(directory,'production-operation.lock');
  const handle=await open(lock,'wx',0o600).catch(()=>{throw new Error('Trwa inne wdrożenie lub odzyskiwanie. Niczego nie zmieniono.');});
  let id,started=false;
  try {
    const matchingOwners=()=>JSON.parse(sql(`SELECT coalesce(json_agg(u.id),'[]'::json) FROM auth.users u JOIN sb.accounts a ON a.user_id=u.id JOIN sb.staff_role_assignments r ON r.user_id=u.id JOIN sb.staff_grants g ON g.user_id=u.id WHERE lower(u.email)=${literal(email)} AND lower(a.email)=lower(u.email) AND u.email_confirmed_at IS NOT NULL AND a.email_verified_at IS NOT NULL AND a.status='active' AND r.role_key='owner' AND r.active AND (r.expires_at IS NULL OR r.expires_at>now()) AND g.active`));
    const owners=matchingOwners();
    guard(owners.length===1 && /^[a-f0-9-]{36}$/i.test(owners[0]),'Wymagane jest dokładnie jedno istniejące, aktywne i potwierdzone konto OWNER. Nie utworzono konta ani roli.');id=owners[0];
    const uid=literal(id)+'::uuid';
    const verifiedFactor=()=>sql(`SELECT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=${uid} AND factor_type='totp' AND status='verified')`)==='t';
    guard(verifiedFactor(),'Brak dotychczasowego potwierdzonego TOTP. Wymagana osobna, kontrolowana procedura; nie wyłączono MFA.');
    await backupInstallation(directory);
    const current=matchingOwners();guard(current.length===1 && current[0]===id,'Stan lub rola OWNER uległy zmianie. Odzyskiwanie zatrzymano.');
    guard(verifiedFactor(),'Stan MFA uległ zmianie. Odzyskiwanie zatrzymano.');
    const protectedState=()=>sql(`SELECT md5(jsonb_build_object('user',(SELECT jsonb_build_object('id',id,'email',email,'email_confirmed_at',email_confirmed_at,'role',role) FROM auth.users WHERE id=${uid}),'account',(SELECT to_jsonb(a) FROM sb.accounts a WHERE user_id=${uid}),'factors',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id),'[]'::jsonb) FROM auth.mfa_factors f WHERE user_id=${uid}),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY role_key) FROM sb.staff_role_assignments r WHERE user_id=${uid}),'grants',(SELECT to_jsonb(g) FROM sb.staff_grants g WHERE user_id=${uid}))::text)`);
    const before=protectedState();
    const audit=status=>sql(`INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(NULL,${literal('owner.password_recovery_'+status)},'auth.users',${literal(id)},${literal(JSON.stringify({incident,operator:'infrastructure',mfaReset:false}))}::jsonb)`);
    audit('started');started=true;
    const auth=await readEnv(path.join(directory,'auth.env'));
    guard((auth.GOTRUE_JWT_ADMIN_ROLES||'').split(',').includes('service_role'),'Auth nie ma oczekiwanej roli administracyjnej. Niczego nie obchodzono.');
    const token=recoveryToken(auth.GOTRUE_JWT_SECRET);
    guard(run(['exec','-T','app','node','--input-type=module','-e',adminPasswordRunner],JSON.stringify({provider:'https://auth-proxy:8444',id,token,...passwordPayload(password)}))==='OK','Auth nie potwierdził zmiany hasła.');
    // The official password update revokes provider sessions/refresh tokens.
    // Revoke only the target's opaque BFF sessions as well, not other users.
    sql(`DELETE FROM sb.sessions WHERE user_id=${uid};`);
    guard(protectedState()===before,'Chronione dane OWNER lub MFA uległy zmianie. Zatrzymaj działania; nie resetuj konta.');
    guard(sql(`SELECT (SELECT count(*) FROM sb.sessions WHERE user_id=${uid})=0 AND (SELECT count(*) FROM auth.sessions WHERE user_id=${uid})=0`)==='t','Nie potwierdzono zakończenia wszystkich sesji OWNER.');
    audit('completed');
    return {updated:true,mfaPreserved:true,signInRequired:true};
  }catch(error){
    if(started)try{sql(`INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(NULL,'owner.password_recovery_failed','auth.users',${literal(id)},${literal(JSON.stringify({incident,operator:'infrastructure',mfaReset:false}))}::jsonb)`);}catch{}
    throw error;
  }finally{await handle.close();await rm(lock,{force:true});}
}

async function hiddenPassword(label) {
  guard(process.stdin.isTTY,'Uruchom interaktywnie na serwerze; hasła nie przyjmujemy z argumentów, plików ani środowiska.');
  process.stdout.write(label+' ');process.stdin.setRawMode(true);process.stdin.resume();let value='';
  try{return await new Promise((resolve,reject)=>{const done=()=>process.stdin.off('data',read);const read=chunk=>{for(const char of chunk.toString()){if(char==='\u0003'){done();reject(new Error('Przerwano bez zmiany hasła.'));return;}if(char==='\r'||char==='\n'){done();resolve(value);return;}if(char==='\u007f'){value=value.slice(0,-1);continue;}if(char>=' ')value+=char;}};process.stdin.on('data',read);});}
  finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const options={};for(const arg of process.argv.slice(2)){const m=/^--(dir|email|incident)=(.+)$/.exec(arg);guard(m,'Dozwolone wyłącznie --dir=, --email=, --incident=. Nigdy nie podawaj hasła w argumentach.');options[m[1]==='dir'?'directory':m[1]]=m[2];}
    recoveryIdentity(options);
    console.log('Wyłącznie kontrolowane odzyskiwanie infrastrukturalne po niezależnym potwierdzeniu tożsamości i zapisaniu incydentu. Istniejący TOTP pozostanie wymagany.');
    const password=await hiddenPassword('Nowe hasło OWNER (ukryte):');
    guard(password===await hiddenPassword('Powtórz nowe hasło (ukryte):'),'Hasła są różne. Niczego nie zmieniono.');
    await recoverOwnerPassword({...options,password});
    console.log('Hasło zmieniono przez prywatny Auth, sesje OWNER zakończono. Zaloguj się normalnie z dotychczasowym MFA. Nie zweryfikowano TOTP w procedurze administracyjnej.');
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
