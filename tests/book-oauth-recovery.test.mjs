import test from 'node:test';import assert from 'node:assert/strict';
import {validatePlannedOriginal,validateBuiltArtifacts,originalOperator,recoverPlannedFlow,checkpointedPair} from '../scripts/book-oauth-recovery-flow.mjs';
import {acceptedBase as base,targetRelease as target,imageFingerprintArguments,runAppOnly} from '../scripts/book-oauth-app-only.mjs';
import {bootstrap,nextAction} from '../scripts/book-oauth-app-only-resume-install.mjs';
const clone=structuredClone;
const old=()=>({kind:'shadowbridge-book-oauth-app-only-v1',installerRelease:originalOperator,phase:'PLANNED',schemaChanged:false,release:target,previousRelease:base,sourceDirectory:'/FICTIONAL/source',previousImage:'sha256:'+'a'.repeat(64),acceptanceHash:'b'.repeat(64),appEnvironmentHash:'c'.repeat(64),appHost:{ReadonlyRootfs:true},appMounts:[],appNetworks:['private'],protected:[{id:'d'.repeat(64),image:'sha256:'+'e'.repeat(64)}]});
test('only exact diagnosed original PLANNED state and matching actual preflight can be adopted',()=>{
 const s=old(),fresh={...clone(s),installerRelease:'f'.repeat(40)};validatePlannedOriginal(s,fresh,{base,target});
 for(const patch of [{installerRelease:'f'.repeat(40)},{phase:'SWAPPING_APP'},{schemaChanged:true},{image:'sha256:'+'f'.repeat(64)},{configHashes:{}},{backups:{}},{bundle:'unexpected'},{ownerInteractiveAcceptance:true}])assert.throws(()=>validatePlannedOriginal({...s,...patch},fresh,{base,target}));
 for(const key of ['acceptanceHash','previousImage','sourceDirectory','appEnvironmentHash','appHost','appMounts','appNetworks','protected'])assert.throws(()=>validatePlannedOriginal(s,{...fresh,[key]:null},{base,target}));
});
test('old/new overlays must be exact and cannot add secrets, services or altered flags',()=>{
 const options={image:'sha256:'+'b'.repeat(64),previousImage:'sha256:'+'a'.repeat(64),target,base},a={services:{app:{image:options.image,environment:{RELEASE_SHA:target}}}},r={services:{app:{image:options.previousImage,environment:{RELEASE_SHA:base}}}};validateBuiltArtifacts(a,r,options);
 for(const change of [x=>x.services.postgres={},x=>x.services.app.environment.OWNER_BOOK_MCP_WRITE_ENABLED='false',x=>x.services.app.image='latest']){const bad=clone(a);change(bad);assert.throws(()=>validateBuiltArtifacts(bad,r,options));}
});
test('recovery adopts into a new state and completes missing backups without build or replacement',async()=>{
 const original=old(),bytes=JSON.stringify(original),calls=[];let sidecar;
 const ops={load:async()=>sidecar,original:async()=>{calls.push('original');return clone(original);},preflight:async()=>{calls.push('preflight');return clone(original);},adopt:async()=>{calls.push('adopt');return{release:target};},save:async s=>{calls.push(s.phase);sidecar=clone(s);},check:async()=>calls.push('check'),ownerMfa:async()=>calls.push('mfa'),backup:async()=>calls.push('backup'),verifyBackups:async()=>calls.push('verify'),build:async()=>assert.fail('must not build'),replace:async()=>assert.fail('must not replace')};
 await recoverPlannedFlow(ops);assert.equal(sidecar.phase,'BACKUPS_VERIFIED_WAITING_OFFSITE');assert.equal(JSON.stringify(original),bytes);assert.deepEqual(calls,['original','preflight','adopt','RECOVERY_VALIDATED','check','mfa','BACKUPS_IN_PROGRESS','backup','verify','BACKUPS_VERIFIED_WAITING_OFFSITE']);
});
test('interrupted recovery resumes backup work, never repeats adoption; unknown/completed phases are blocked',async()=>{
 for(const phase of ['RECOVERY_VALIDATED','BACKUPS_IN_PROGRESS']){let s={phase};let adoption=0;const ops={load:async()=>clone(s),save:async x=>{s=clone(x);},adopt:async()=>adoption++,check:async()=>{},ownerMfa:async()=>{},backup:async()=>{},verifyBackups:async()=>{}};await recoverPlannedFlow(ops);assert.equal(adoption,0);assert.equal(s.phase,'BACKUPS_VERIFIED_WAITING_OFFSITE');}
 for(const phase of ['PLANNED','SWAPPING_APP','DEPLOYED_AND_VERIFIED'])await assert.rejects(recoverPlannedFlow({load:async()=>({phase})}));
});
test('failed checks or MFA cannot create backups',async()=>{
 for(const field of ['check','ownerMfa']){let backups=0;const ops={load:async()=>({phase:'RECOVERY_VALIDATED'}),check:async()=>{},ownerMfa:async()=>{},backup:async()=>backups++,save:async()=>{}};ops[field]=async()=>{throw Error('FICTIONAL denied');};await assert.rejects(recoverPlannedFlow(ops));assert.equal(backups,0);}
});
test('missing/corrupt recovery proof is not treated as an absent state and cannot trigger re-adoption',async()=>{
 let adopted=0;await assert.rejects(recoverPlannedFlow({load:async()=>{throw Object.assign(Error('Missing origin receipt'),{code:'ENOENT'});},adopt:async()=>adopted++}));assert.equal(adopted,0);
});
test('backup pairs journal intent before creation; complete pairs survive interruption before final save',async()=>{
 const expected={backupFile:'/FICTIONAL/database.sbb',keyFile:'/FICTIONAL/database.key'},s={},calls=[];let complete=false,creates=0;
 const ops={save:async()=>calls.push('save'),anyArtifacts:async()=>complete,completePair:async()=>complete};
 const create=async()=>{assert.equal(s.backupStages.database.phase,'CREATING');creates++;complete=true;return expected;};
 await assert.rejects(checkpointedPair(ops,s,'database',expected,{create,verify:async()=>{throw Error('FICTIONAL interrupted verification');}}));assert.equal(s.backups.database,undefined);
 await checkpointedPair(ops,s,'database',expected,{create,verify:async()=>{}});assert.equal(creates,1);assert.equal(s.backupStages.database.phase,'VERIFIED');assert.deepEqual(s.backups.database,expected);
 await checkpointedPair(ops,s,'database',expected,{create:async()=>assert.fail('recorded pair must be reused'),verify:async()=>{}});
});
test('unrecorded, partial, corrupt or path-substituted backups stop without overwrite',async()=>{
 const p={backupFile:'/FICTIONAL/x.sbb',keyFile:'/FICTIONAL/x.key'};
 const ops={save:async()=>{},anyArtifacts:async()=>true,completePair:async()=>false};
 await assert.rejects(checkpointedPair(ops,{},'database',p,{create:async()=>assert.fail(),verify:async()=>{}}),/Unrecorded/);
 const s={backupStages:{database:{phase:'CREATING',paths:p}}};await assert.rejects(checkpointedPair(ops,s,'database',p,{create:async()=>assert.fail(),verify:async()=>{}}),/Partial backup/);
 await assert.rejects(checkpointedPair({...ops,completePair:async()=>true},s,'database',p,{verify:async()=>{throw Error('GCM rejected');}}));assert.equal(s.backups.database,undefined);
 await assert.rejects(checkpointedPair(ops,{backups:{database:{...p,keyFile:'/OTHER'}}},'database',p,{verify:async()=>assert.fail()}));
});
test('new launcher can only recover the existing state, never prepare/build; fixed image fingerprint is isolated',async()=>{
 const script=bootstrap('a'.repeat(40));assert.ok(script.includes('recover-plan'));assert.ok(script.includes('--recovery'));assert.ok(!/\.mjs prepare|docker build|migrator|reset|down -v/.test(script));
 for(const p of ['RECOVERY_REQUIRED','RECOVERY_VALIDATED','BACKUPS_IN_PROGRESS'])assert.equal(nextAction(p),'recover');for(const p of ['NONE','PLANNED','ROLLED_BACK_APPLICATION_ONLY'])assert.throws(()=>nextAction(p));
 const args=imageFingerprintArguments('sha256:'+'a'.repeat(64),['server/app.mjs']);assert.ok(args.includes('none')&&args.includes('--read-only')&&args.includes('--pull'));assert.ok(!args.includes('--env-file'));assert.equal(args.at(-1),'/app/server/app.mjs');
 await assert.rejects(runAppOnly({phase:'prepare',installerRelease:'a'.repeat(40),recovery:true}),/Unknown app-only phase/);
});
