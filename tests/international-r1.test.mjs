import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile,stat,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { prepareStaging,repositoryRoot } from '../scripts/staging-prepare.mjs';
import { prepareProduction,checkProduction } from '../scripts/production-config.mjs';
import { productionBase,prepareGatewayProfile,saveGatewayState } from '../scripts/n8n-gateway-profile.mjs';
import { assertApplicationOnly,prepareApplicationPlan,checkApplicationPlan,applicationArguments,checkMergedApplication,backupApplicationConfiguration,verifyR1Http } from '../scripts/international-r1.mjs';
import { decryptArchive } from '../scripts/staging-backup.mjs';
const image='sha256:'+'a'.repeat(64),previousImage='sha256:'+'b'.repeat(64),releaseSha='c'.repeat(40);
test('R1 refuses any Compose change beyond the immutable application image and release marker',()=>{
 const base={name:'fixture',services:{app:{image:'old',environment:{SESSION_ENCRYPTION_KEY:'fictional-preserved',RELEASE_SHA:productionBase}},auth:{image:'auth'},gateway:{image:'caddy',networks:['edge']},postgres:{networks:['private']}},networks:{edge:{external:true}}};
 const merged=structuredClone(base);merged.services.app.image=image;merged.services.app.environment.RELEASE_SHA=releaseSha;
 assert.doesNotThrow(()=>assertApplicationOnly(base,merged,{image,releaseSha}));
 for(const modify of [v=>v.services.gateway.networks.pop(),v=>v.services.auth.image='other',v=>v.services.postgres.ports=['5432:5432'],v=>v.services.app.environment.SESSION_ENCRYPTION_KEY='changed',v=>v.services.app.ports=['8088:8088']]){const value=structuredClone(merged);modify(value);assert.throws(()=>assertApplicationOnly(base,value,{image,releaseSha}));}
 assert.throws(()=>assertApplicationOnly(base,merged,{image:'app:latest',releaseSha}));
});
test('R1 HTTP verifier checks the new app SHA and automation independently; synthetic responses are not a deployment test',async()=>{
 const probe=({oldApp=false,basic=false,unhealthy=false}={})=>async(input,options={})=>{
  const url=new URL(input);
  if(url.hostname==='automation.shadow-bridge.eu')return new Response(url.pathname==='/healthz'?JSON.stringify({status:unhealthy?'error':'ok'}):'<html>FICTIONAL sign in</html>',{status:basic?401:200,headers:basic?{'WWW-Authenticate':'Basic realm=fictional'}:{}});
  const headers={'X-ShadowBridge-Release':oldApp?productionBase:releaseSha,'Content-Type':'application/json'};
  if(url.pathname==='/health')return new Response(JSON.stringify({ok:true}),{headers});
  if(url.pathname==='/api/config')return new Response(JSON.stringify({backendEnabled:true,releaseSha,capabilities:{registration:false,passwordRecovery:false,emailVerification:false}}),{headers});
  if(options.method==='POST')return new Response(JSON.stringify({code:'MAIL_NOT_ENABLED'}),{status:503,headers});
  if(url.pathname.startsWith('/portal/'))return new Response('',{status:303,headers:{...headers,Location:'/member-sign-in/'}});
  if(['/.env','/.git/config','/server/app.mjs','/auth/v1/settings','/prototypes/'].includes(url.pathname))return new Response('',{status:404,headers});
  return new Response('<html>FICTIONAL public page</html>',{headers});
 };
 assert.equal((await verifyR1Http(releaseSha,{request:probe()})).automationHttpVerified,true);
 for(const spec of [{oldApp:true},{basic:true},{unhealthy:true}])await assert.rejects(verifyR1Http(releaseSha,{request:probe(spec)}));
});
test('R1 planning preserves all profile/gateway bytes, fails closed on drift, and validates both actual Compose overlays',async()=>{
 const id=randomBytes(5).toString('hex'),directory=path.join(repositoryRoot,'.local','r1-plan-test-'+id);
 const checked=await prepareStaging({directory,project:'shadowbridge-stageg-r1plan-'+id});
 let profile=await prepareProduction({directory:checked.directory,releaseSha:productionBase});
 await assert.rejects(prepareApplicationPlan({profile,image,releaseSha,previousImage,previousReleaseSha:productionBase}));
 const gateway=await prepareGatewayProfile(profile);await saveGatewayState(profile,{phase:'active'});profile=await checkProduction({directory});
 const originals=await Promise.all([path.join(profile.directory,'manifest.json'),path.join(gateway.directory,'manifest.json'),path.join(profile.sourceDirectory,'manifest.json')].map(f=>readFile(f)));
 const candidate=await prepareApplicationPlan({profile,image,releaseSha,previousImage,previousReleaseSha:productionBase});
 assert.equal((await checkApplicationPlan({profile,directory:candidate.directory})).releaseSha,releaseSha);
 checkMergedApplication(profile,candidate.directory,candidate.plan);
 for(const file of ['apply-application.sh','rollback-application.sh'])assert.throws(()=>execFileSync(path.join(candidate.directory,file),[],{stdio:['ignore','pipe','pipe']}),error=>error.status===2,'Generated operator scripts require acknowledgement before any command');
 const args=applicationArguments(profile,candidate.directory);
 assert.ok(args.includes(gateway.override));assert.equal(args.at(-1),'app');assert.ok(args.includes('--no-deps'));assert.ok(args.includes('--no-build'));
 assert.deepEqual(await Promise.all([path.join(profile.directory,'manifest.json'),path.join(gateway.directory,'manifest.json'),path.join(profile.sourceDirectory,'manifest.json')].map(f=>readFile(f))),originals);
 const backup=await backupApplicationConfiguration({profile,directory:candidate.directory});
 assert.equal((await stat(backup.backupFile)).mode&0o777,0o600);
 const archive=path.join(candidate.directory,'authenticated-config-test.tar');await decryptArchive({...backup,archiveFile:archive});
 const restored=path.join(candidate.directory,'restored-config-test');await mkdir(restored,{mode:0o700});execFileSync('tar',['-xf',archive,'-C',restored]);
 for(const file of Object.keys(candidate.plan.fingerprints).filter(f=>f.startsWith(profile.sourceDirectory+path.sep)))assert.deepEqual(await readFile(file),await readFile(path.join(restored,path.relative(profile.sourceDirectory,file))));
 await assert.rejects(prepareApplicationPlan({profile,image,releaseSha,previousImage,previousReleaseSha:productionBase}));
 await writeFile(path.join(candidate.directory,'application.json'),JSON.stringify({services:{app:{image},gateway:{ports:['1234:443']}}}),{mode:0o600});
 await assert.rejects(checkApplicationPlan({profile,directory:candidate.directory}));
 await assert.rejects(checkApplicationPlan({profile,directory:path.join(repositoryRoot,'.local','unrelated')}));
});
