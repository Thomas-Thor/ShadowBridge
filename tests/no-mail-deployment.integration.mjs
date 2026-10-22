// Reuse ONLY the preserved fictional project. No prepare/new project, schema
// migrations, external mail, public DNS, VPS, or production deployment.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import https from 'node:https';
import path from 'node:path';
import {checkStaging,readEnv,repositoryRoot} from '../scripts/staging-prepare.mjs';
import {prepareProduction} from '../scripts/production-config.mjs';
import {compose,backupInstallation} from '../scripts/staging-ops.mjs';
import {databaseFingerprints,assertPreserved,verifyBackupArchive,verifyPublic} from '../scripts/production-ops.mjs';
import {recoverOwnerPassword} from '../scripts/owner-password-recovery.mjs';

const directory=process.argv.find(v=>v.startsWith('--dir='))?.slice(6);
assert.ok(directory,'Explicit preserved fictional --dir required');
const checked=await checkStaging({directory});assert.match(checked.project,/^shadowbridge-stageg-production-[a-f0-9]{10}$/);
const marker=JSON.parse(await readFile(path.join(checked.directory,'production-test-fixture.json'),'utf8'));
assert.equal(marker.kind,'shadowbridge-production-isolated-v1');assert.equal(marker.project,checked.project);
const state=JSON.parse(await readFile(path.join(checked.directory,'production-test-actors.json'),'utf8'));
assert.equal(state.project,checked.project);for(const a of Object.values(state.actors))assert.match(a.email,/@test[.]shadowbridge[.]invalid$/);
const docker=(parts,options={})=>execFileSync('docker',['--context','default',...parts],{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,...options}).trim();
const projects=()=>docker(['ps','-a','--format','{{.Label "com.docker.compose.project"}}']).split('\n').filter(Boolean).sort();
const volumes=()=>docker(['volume','ls','-q']).split('\n').sort();
const initialProjects=projects(),initialVolumes=volumes();
const configFile=path.join(checked.directory,'no-mail-test.compose.json');
let candidate=false,current='preserved fixture readiness';
const report={kind:'real-preserved-no-mail-integration',cases:[],mocksUsed:false,newEnvironmentCreated:false,externalEmailSent:false,contaboDeployed:false,imageBuildTested:false,runtimeBindMounted:true};
const phase=async(name,fn)=>{current=name;await fn();report.cases.push({name,result:'PASS'});console.log('PASS: '+name);};
const run=parts=>docker(['compose','--project-name',checked.project,'-f',configFile,...parts]);
const pg=()=>docker(['ps','-q','--filter','label=com.docker.compose.project='+checked.project,'--filter','label=com.docker.compose.service=postgres']);
const sql=query=>docker(['exec',pg(),'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',query]);
const originalFetch=globalThis.fetch;
try {
  await compose(checked.directory,['up','-d','--wait','--wait-timeout','120','postgres'],{capture:true});
  assert.equal(sql("SELECT count(*) FROM auth.users WHERE email !~ '@test[.]shadowbridge[.]invalid$'"),'0');
  const before=await databaseFingerprints(checked.directory);
  let releaseSha;
  await phase('existing backup authenticated and catalog checked without a new database',async()=>{
    const backup=await backupInstallation(checked.directory);
    const proof=await verifyBackupArchive({directory:checked.directory,...backup});
    assert.equal(proof.archiveAuthenticated,true);assert.equal(proof.restored,false);assert.equal(proof.newInfrastructureCreated,false);
  });
  await phase('no-mail configuration starts on existing volumes and preserves accounts/passwords/MFA/roles',async()=>{
    releaseSha=execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim();
    const profile=await prepareProduction({directory:checked.directory,releaseSha});
    const config=JSON.parse(await readFile(path.join(checked.directory,'production-test.compose.json'),'utf8'));
    Object.assign(config.services.app.environment,await readEnv(path.join(profile.directory,'app.env')));
    Object.assign(config.services.auth.environment,await readEnv(path.join(profile.directory,'auth.env')));
    delete config.services.auth.environment.GOTRUE_SMTP_USER;delete config.services.auth.environment.GOTRUE_SMTP_PASS;
    config.services.auth.networks={private:null};
    config.services.app.volumes=[...(config.services.app.volumes||[]),{type:'bind',source:path.join(repositoryRoot,'server'),target:'/app/server',read_only:true},{type:'bind',source:path.join(repositoryRoot,'assets/account.js'),target:'/app/assets/account.js',read_only:true}];
    await writeFile(configFile,JSON.stringify(config)+'\n',{mode:0o600});candidate=true;
    run(['up','-d','--no-build','--wait','--wait-timeout','120','auth','app','gateway']);
    assertPreserved(before,await databaseFingerprints(checked.directory));
    assert.equal(config.services.auth.environment.GOTRUE_DISABLE_SIGNUP,'true');assert.equal(config.services.auth.environment.GOTRUE_EXTERNAL_EMAIL_ENABLED,'true');
    assert.equal(config.services.auth.environment.GOTRUE_SMTP_HOST,'127.0.0.1');assert.equal(config.services.auth.environment.GOTRUE_SMTP_PORT,'1');
  });
  const ca=await readFile(path.join(checked.directory,'certs/internal-ca.crt'));
  globalThis.fetch=(input,options={})=>{
    const url=new URL(input);assert.equal(url.origin,'https://shadow-bridge.eu','No external requests allowed');
    const headers=new Headers(options.headers);headers.set('Host','shadow-bridge.eu');
    return new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:443,servername:'shadow-bridge.eu',ca,path:url.pathname+url.search,method:options.method||'GET',headers:Object.fromEntries(headers)},res=>{
      const chunks=[];res.on('data',v=>chunks.push(v));res.on('end',()=>{const out=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)out.append(res.rawHeaders[i],res.rawHeaders[i+1]);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:out}));});});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('Local timeout')));req.end(options.body);});
  };
  process.env.SHADOWBRIDGE_TEST_URL='https://shadow-bridge.eu';process.env.SHADOWBRIDGE_DB_CONTAINER=pg();process.env.DOCKER_CONTEXT='default';
  const h=await import('../server/tests/helpers.mjs');
  const ready=async()=>{for(let i=0;i<40;i++){try{if((await fetch('https://shadow-bridge.eu/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('API readiness failed');};
  await ready();
  await phase('public routes and email endpoints reflect no-mail mode with no new accounts',async()=>{
    const count=sql('SELECT count(*) FROM auth.users');
    await verifyPublic(releaseSha,{request:globalThis.fetch,mailDisabled:true});
    for(const route of ['/auth/confirm?token=fictional','/auth/recover?token=fictional'])assert.equal((await fetch('https://shadow-bridge.eu'+route)).status,503);
    assert.equal(sql('SELECT count(*) FROM auth.users'),count);
  });
  const owner={...state.actors.owner,client:new h.Client()},buyer={...state.actors.buyer,client:new h.Client()};
  await phase('existing Buyer and OWNER sign in; Command Center requires original MFA',async()=>{
    await buyer.client.signIn(buyer);assert.ok((await buyer.client.request('/api/rfqs',{expected:200})).data.items.length>0);
    await owner.client.signIn(owner);await owner.client.request('/api/staff/access',{expected:403});
    await owner.client.request('/api/auth/mfa/verify',{method:'POST',body:{factorId:owner.factorId,code:h.totp(owner.mfaSecret)},expected:200});
    await owner.client.request('/api/staff/overview',{expected:200});
    const client=new h.Client();const result=await client.request('/api/contact',{method:'POST',body:{name:'FICTIONAL no-mail check',email:'nomail@test.shadowbridge.invalid',company:'FICTIONAL',role:'buyer',message:'FICTIONAL queue verification without outgoing email.',consent:true,website:''},expected:201});
    assert.equal(result.data.accepted,true);
  });
  await phase('controlled OWNER password recovery preserves MFA and revokes only OWNER sessions',async()=>{
    const replacement=h.password();
    const result=await recoverOwnerPassword({directory:checked.directory,email:owner.email,incident:'FICTIONAL-NO-MAIL-RECOVERY',password:replacement});
    assert.equal(result.mfaPreserved,true);await ready();
    assert.equal((await owner.client.request('/api/session',{expected:200})).data.user,null);
    assert.equal((await buyer.client.request('/api/session',{expected:200})).data.user.id,buyer.user.id);
    const obsolete=new h.Client();await obsolete.request('/api/auth/login',{method:'POST',body:{email:owner.email,password:owner.password},expected:401});
    state.actors.owner.password=replacement;
    await writeFile(path.join(checked.directory,'production-test-actors.json'),JSON.stringify(state)+'\n',{mode:0o600});
    owner.password=replacement;owner.client=new h.Client();await owner.client.signIn(owner);
    await owner.client.request('/api/staff/access',{expected:403});
    await owner.client.request('/api/auth/mfa/verify',{method:'POST',body:{factorId:owner.factorId,code:h.totp(owner.mfaSecret)},expected:200});
    await owner.client.request('/api/staff/overview',{expected:200});
    state.actors.owner={...owner,client:{cookies:[...owner.client.cookies],csrf:owner.client.csrf}};
    await writeFile(path.join(checked.directory,'production-test-actors.json'),JSON.stringify(state)+'\n',{mode:0o600});
  });
  report.result='PASS';
}catch(error){report.result='FAIL';report.failedCase=current;report.errorType=error.name;await writeFile(path.join(checked.directory,'no-mail-test-failure.json'),JSON.stringify({case:current,name:error.name,message:error.message,stack:error.stack})+'\n',{mode:0o600});console.error('FAIL: '+current+'; private diagnostics retained');process.exitCode=1;}
finally {
  globalThis.fetch=originalFetch;
  if(candidate)run(['stop']);else await compose(checked.directory,['stop'],{capture:true});
  assert.deepEqual(projects(),initialProjects);assert.deepEqual(volumes(),initialVolumes);
  report.existingProjectsAndVolumesPreserved=true;report.fixtureStopped=true;report.finishedAt=new Date().toISOString();
  await writeFile('/tmp/shadowbridge-no-mail-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
