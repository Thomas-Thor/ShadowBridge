// Optional targeted real lifecycle test on the already guarded fictional
// production fixture. It never accepts an owner's project or touches DNS.
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import { checkStaging } from '../scripts/staging-prepare.mjs';
import { compose } from '../scripts/staging-ops.mjs';
import { databaseFingerprints,assertPreserved,rollbackPrivate } from '../scripts/production-ops.mjs';

const directory=process.argv.find(value=>value.startsWith('--dir='))?.slice(6);
assert.ok(directory,'Explicit isolated fixture --dir is required');
const checked=await checkStaging({directory});
assert.match(checked.project,/^shadowbridge-stageg-production-[a-f0-9]{10}$/);
const marker=JSON.parse(await readFile(path.join(checked.directory,'production-test-fixture.json'),'utf8'));
assert.equal(marker.kind,'shadowbridge-production-isolated-v1');assert.equal(marker.project,checked.project);
const state=JSON.parse(await readFile(path.join(checked.directory,'production-test-actors.json'),'utf8'));
assert.equal(state.project,checked.project);
for(const actor of Object.values(state.actors))assert.match(actor.email,/@test[.]shadowbridge[.]invalid$/);
const docker=args=>execFileSync('docker',['--context','default',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const ids=docker(['ps','-aq','--filter','label=com.docker.compose.project='+checked.project]).trim().split('\n').filter(Boolean);
const images=ids.map(id=>JSON.parse(docker(['inspect',id]))[0]).map(c=>({service:c.Config.Labels['com.docker.compose.service'],image:c.Image}));
const checkpoint='public-rollback-proof-'+randomBytes(4).toString('hex'),folder=path.join(checked.directory,'backups',checkpoint);
await mkdir(folder,{recursive:true,mode:0o700});
await writeFile(path.join(folder,'previous-images.json'),JSON.stringify({project:checked.project,images})+'\n',{mode:0o600,flag:'wx'});
let result;
try {
  await compose(checked.directory,['up','-d','--wait','--wait-timeout','120','postgres'],{capture:true});
  const pg=execFileSync('docker',['--context','default','ps','-q','--filter','label=com.docker.compose.project='+checked.project,'--filter','label=com.docker.compose.service=postgres'],{encoding:'utf8'}).trim();
  assert.equal(docker(['exec',pg,'psql','-XqAt','-U','postgres','-d','shadowbridge','-c',"SELECT count(*) FROM auth.users WHERE email !~ '@test[.]shadowbridge[.]invalid$'"]).trim(),'0');
  const before=await databaseFingerprints(checked.directory);
  await rollbackPrivate({directory:checked.directory,checkpoint});
  await compose(checked.directory,['stop','app','auth'],{capture:true});
  assertPreserved(before,await databaseFingerprints(checked.directory));
  await compose(checked.directory,['start','auth','app'],{capture:true});
  const ca=await readFile(path.join(checked.directory,'certs/internal-ca.crt'));
  const reviewer=(await readFile(path.join(checked.directory,'tester-password'),'utf8')).trim();
  const request=(pathname,authenticated=false,cookies='')=>new Promise((resolve,reject)=>{
    const req=https.request({hostname:'127.0.0.1',port:checked.httpsPort,servername:'localhost',ca,path:pathname,
      headers:{Host:'localhost:'+checked.httpsPort,...(authenticated?{Authorization:'Basic '+Buffer.from('reviewer:'+reviewer).toString('base64')}:{}),...(cookies?{Cookie:cookies}:{})}},res=>{
      const chunks=[];res.on('data',value=>chunks.push(value));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString()}));
    });req.setTimeout(10000,()=>req.destroy(new Error('readiness timeout')));req.on('error',reject);req.end();
  });
  let ready=false;
  for(let i=0;i<40;i++){try{if((await request('/health',true)).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  assert.equal(ready,true);
  assert.equal((await request('/api/config')).status,401);
  assert.equal((await request('/api/config',true)).status,200);
  const cookies=state.actors.owner.client.cookies.map(([key,value])=>key+'='+value).join('; ');
  const session=await request('/api/session',true,cookies);assert.equal(session.status,200);
  const user=JSON.parse(session.text).user;assert.equal(user.id,state.actors.owner.user.id);assert.equal(user.aal,'aal2');
  assert.equal((await request('/api/staff/overview',true,cookies)).status,200);
  result={name:'actual rollback restores saved images and private gateway without data loss',result:'PASS',ownerSessionAndMfaPreserved:true};
  console.log('PASS: actual saved-image rollback, private Basic Auth, data, OWNER session and MFA.');
}catch(error){result={result:'FAIL',errorType:error.name};await writeFile(path.join(folder,'rollback-failure.json'),JSON.stringify({name:error.name,message:error.message})+'\n',{mode:0o600});console.error('FAIL: targeted rollback; private diagnostics retained.');process.exitCode=1;}
finally{
  await compose(checked.directory,['stop'],{capture:true});
  result.fixtureStoppedWithoutVolumeRemoval=true;
  await writeFile('/tmp/shadowbridge-production-rollback-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
}
