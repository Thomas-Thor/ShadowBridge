import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appOnlyFlow,validateBaseReceipt,validateLedger,acceptedBase,targetRelease,resumeAction,composeSwapArguments,runtimePaths,parseCertificateHashes,runAppOnly,canonicalMounts,appContinuity,assertAppContinuity} from '../scripts/book-oauth-app-only.mjs';
import {bootstrap,nextAction,validateManifest} from '../scripts/book-oauth-app-only-install.mjs';
import {migrationSources} from '../scripts/staging-migrate.mjs';

const clone=v=>JSON.parse(JSON.stringify(v));
test('Docker mount listing order is normalized while every mount property remains protected',()=>{
 const a={Destination:'/a',Source:'/private/a',RW:false},b={Destination:'/b',Source:'/private/b',RW:false};
 assert.deepEqual(canonicalMounts([a,b]),canonicalMounts([b,a]));assert.notDeepEqual(canonicalMounts([a,b]),canonicalMounts([{...a,RW:true},b]));
});
test('configuration changes during offsite transfer block replacement/rollback without storing environment secrets',()=>{
 const c={Image:'sha256:'+'a'.repeat(64),Config:{Env:['RELEASE_SHA='+acceptedBase,'EXAMPLE='+randomUUID()]},HostConfig:{ReadonlyRootfs:true},Mounts:[{Destination:'/ca',Source:'/private/ca',RW:false}],NetworkSettings:{Networks:{private:{}}}};
 const s={previousImage:c.Image,image:'sha256:'+'b'.repeat(64),...appContinuity(c)};assertAppContinuity(c,s);assert.ok(!JSON.stringify(s).includes(c.Config.Env[1]));
 const next=clone(c);next.Image=s.image;next.Config.Env[0]='RELEASE_SHA='+targetRelease;assertAppContinuity(next,s);
 for(const change of [x=>x.Config.Env.push('EXTRA=unapproved'),x=>x.HostConfig.ReadonlyRootfs=false,x=>x.Mounts[0].RW=true,x=>x.NetworkSettings.Networks.public={},x=>x.Image='unknown']){const bad=clone(c);change(bad);assert.throws(()=>assertAppContinuity(bad,s));}
});
function fixture(initial=null,fail={}){
 let state=initial&&clone(initial),running='old';const calls=[];
 const action=(name,result)=>async(...args)=>{calls.push(name);if(fail[name])throw Error('FICTIONAL fault');return typeof result==='function'?result(...args):result;};
 const ops={load:async()=>state&&clone(state),save:async s=>{state=clone(s);calls.push('save:'+s.phase);},preflight:action('preflight',{release:targetRelease,previousRelease:acceptedBase}),build:action('build'),backup:action('backup'),verifyBackups:action('verifyBackups'),check:action('check'),verifyOffsite:action('verifyOffsite'),ownerMfa:action('ownerMfa'),alreadyRunningTarget:action('alreadyRunningTarget',()=>running==='new'),replace:action('replace',()=>{running='new';}),rollback:action('rollback',()=>{running='old';}),verify:async(s,old)=>{calls.push(old?'verifyOld':'verifyNew');if(fail[old?'verifyOld':'verifyNew'])throw Error('FICTIONAL failed health');assert.equal(running,old?'old':'new');}};
 return{ops,calls,state:()=>state,active:v=>{running=v;}};
}
test('only accepted 80f4a0d checkpoint/image qualifies; active OWNER cannot be inferred from a name',()=>{
 const s={release:acceptedBase,purpose:'book-write',phase:'DEPLOYED_AND_VERIFIED',ownerInteractiveAcceptance:true,image:'sha256:'+'a'.repeat(64)};validateBaseReceipt(s);
 for(const p of [{release:targetRelease},{phase:'DEPLOYED_PENDING_OWNER_ACCEPTANCE'},{ownerInteractiveAcceptance:false},{purpose:'book-create'},{image:'latest'}])assert.throws(()=>validateBaseReceipt({...s,...p}));
});
test('ledger gate accepts exactly all current 001–021 hashes and rejects gaps, changes, extra or missing rows',async()=>{
 const sources=await migrationSources(),rows=sources.map(({name,sha256})=>({name,sha256}));validateLedger(sources,rows);
 for(const r of [rows.slice(0,-1),rows.slice(1),[...rows,{name:'022.sql',sha256:'a'.repeat(64)}],rows.map((r,i)=>i? r:{...r,sha256:'0'.repeat(64)})])assert.throws(()=>validateLedger(sources,r));
});
test('prepare performs no image replacement and cannot overwrite a checkpoint',async()=>{
 const f=fixture();const s=await appOnlyFlow(f.ops,'prepare');assert.equal(s.phase,'BACKUPS_VERIFIED_WAITING_OFFSITE');assert.equal(s.schemaChanged,false);
 assert.deepEqual(f.calls,['preflight','save:PLANNED','build','backup','verifyBackups','save:BACKUPS_VERIFIED_WAITING_OFFSITE']);await assert.rejects(appOnlyFlow(f.ops,'prepare'));assert.ok(!f.calls.includes('replace'));
});
test('preflight/backup failures never replace the app',async()=>{
 for(const name of ['preflight','build','backup','verifyBackups']){const f=fixture(null,{[name]:true});await assert.rejects(appOnlyFlow(f.ops,'prepare'));assert.ok(!f.calls.includes('replace'));}
});
test('apply requires check, authenticated backups, offsite receipt and fresh MFA before the only replacement',async()=>{
 const f=fixture({phase:'BACKUPS_VERIFIED_WAITING_OFFSITE'});const s=await appOnlyFlow(f.ops,'apply');assert.equal(s.phase,'DEPLOYED_PENDING_OWNER_ACCEPTANCE');
 assert.deepEqual(f.calls.slice(0,5),['check','verifyBackups','verifyOffsite','ownerMfa','save:SWAPPING_APP']);assert.equal(f.calls.filter(c=>c==='replace').length,1);
 for(const name of ['check','verifyBackups','verifyOffsite','ownerMfa']){const f=fixture({phase:'BACKUPS_VERIFIED_WAITING_OFFSITE'},{[name]:true});await assert.rejects(appOnlyFlow(f.ops,'apply'));assert.ok(!f.calls.includes('replace'));assert.equal(f.state().phase,'BACKUPS_VERIFIED_WAITING_OFFSITE');}
});
test('failed new health rolls back and verifies old image, with no DB/migration hook',async()=>{
 const f=fixture({phase:'BACKUPS_VERIFIED_WAITING_OFFSITE'},{verifyNew:true});await assert.rejects(appOnlyFlow(f.ops,'apply'),/APPLICATION_ROLLED_BACK/);
 assert.equal(f.state().phase,'ROLLED_BACK_APPLICATION_ONLY');assert.deepEqual(f.calls.slice(-3),['rollback','verifyOld','save:ROLLED_BACK_APPLICATION_ONLY']);assert.ok(!f.calls.some(c=>/migrat|reset|restore/.test(c)));
});
test('unverified rollback preserves SWAPPING checkpoint and fails closed',async()=>{
 const f=fixture({phase:'BACKUPS_VERIFIED_WAITING_OFFSITE'},{verifyNew:true,rollback:true});await assert.rejects(appOnlyFlow(f.ops,'apply'),/ROLLBACK_UNVERIFIED/);assert.equal(f.state().phase,'SWAPPING_APP');
});
test('resume of an already running target verifies without repeating replacement or backup',async()=>{
 const f=fixture({phase:'SWAPPING_APP'});f.active('new');await appOnlyFlow(f.ops,'resume');assert.ok(!f.calls.includes('replace'));assert.ok(!f.calls.includes('backup'));assert.equal(f.state().phase,'DEPLOYED_PENDING_OWNER_ACCEPTANCE');
 const old=fixture({phase:'SWAPPING_APP'});await appOnlyFlow(old.ops,'resume');assert.equal(old.calls.filter(c=>c==='replace').length,1);
});
test('pending acceptance needs post-update MFA and accepted release verify never redeploys',async()=>{
 const f=fixture({phase:'DEPLOYED_PENDING_OWNER_ACCEPTANCE',appliedAt:'2026-10-26T01:00:00.000Z'});f.active('new');await appOnlyFlow(f.ops,'accept');assert.equal(f.state().ownerInteractiveAcceptance,true);assert.ok(f.calls.includes('ownerMfa'));f.calls.length=0;await appOnlyFlow(f.ops,'verify');assert.deepEqual(f.calls,['verifyNew']);
 const bad=fixture({phase:'DEPLOYED_PENDING_OWNER_ACCEPTANCE'},{ownerMfa:true});bad.active('new');await assert.rejects(appOnlyFlow(bad.ops,'accept'));assert.equal(bad.state().phase,'DEPLOYED_PENDING_OWNER_ACCEPTANCE');
});
test('explicit rollback requires fresh MFA; unknown phases never restart work',async()=>{
 const f=fixture({phase:'DEPLOYED_AND_VERIFIED'});f.active('new');await appOnlyFlow(f.ops,'rollback');assert.deepEqual(f.calls,['ownerMfa','rollback','verifyOld','save:ROLLED_BACK_APPLICATION_ONLY']);
 for(const phase of ['PLANNED','ROLLED_BACK_APPLICATION_ONLY','MIGRATING']){assert.throws(()=>resumeAction(phase));assert.throws(()=>nextAction(phase));}
 for(const phase of ['NONE','BACKUPS_VERIFIED_WAITING_OFFSITE','SWAPPING_APP','DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED'])assert.equal(resumeAction(phase),nextAction(phase));
});
test('app-only command cannot build, pull, migrate or start dependencies; source enumeration matches Docker ignore',()=>{
 const args=composeSwapArguments(['compose','--project-name','FICTIONAL','-f','base.json'],'application.json');assert.deepEqual(args.slice(-10),['up','-d','--no-build','--no-deps','--pull','never','--wait','--wait-timeout','120','app']);
 assert.deepEqual(runtimePaths(['server/app.mjs','assets/prototypes.js','server/tests/secret.mjs','scripts/staging-migrate.mjs','assets/fonts/font.woff2']),['server/app.mjs','assets/fonts/font.woff2']);
});
test('standalone bootstrap pins branch/installer SHA and never invokes old coordinator/migrator/reset',()=>{
 const script=bootstrap('a'.repeat(40));assert.ok(script.includes('feature/owner-book-mcp-scoped-write'));assert.ok(script.includes("merge --ff-only '"+'a'.repeat(40)));assert.ok(script.includes('book-oauth-app-only.mjs prepare'));assert.ok(!/r1-production-release|migrator|down -v|reset|force-push|npm ci/.test(script));assert.throws(()=>bootstrap('main'));
});
test('offsite manifest requires exactly the six unique safe names, sizes and checksums',()=>{
 const m={kind:'shadowbridge-r1-offsite-bundle-v1',release:targetRelease,nonce:randomUUID(),files:['database','configuration','certificates'].flatMap(n=>['key','sbb'].map(e=>({name:n+'.'+e,sha256:'a'.repeat(64),bytes:32})))};validateManifest(m);
 for(const p of [{release:acceptedBase},{files:m.files.slice(1)},{files:[m.files[0],...m.files.slice(1,5),m.files[0]]},{files:m.files.map(f=>({...f,bytes:0}))},{files:m.files.map(f=>({...f,name:'../'+f.name}))}])assert.throws(()=>validateManifest({...m,...p}));
});
test('certificate inventory is bounded to data/config hashes; production guard refuses this environment',async()=>{
 assert.deepEqual(parseCertificateHashes('a'.repeat(64)+'  /data/cert.pem\n'),{'data/cert.pem':'a'.repeat(64)});for(const s of ['', 'a'.repeat(64)+'  /etc/shadow','a'.repeat(64)+'  /data/../secret'])assert.throws(()=>parseCertificateHashes(s));
 await assert.rejects(runAppOnly({phase:'prepare',installerRelease:'a'.repeat(40)}),/sudo as shadowadmin/);
});
