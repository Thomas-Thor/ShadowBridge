// Operator-only recovery contracts. No Docker, migration, build or network code.
import {isDeepStrictEqual as same} from 'node:util';
export const originalOperator='53cc1ae500f55f2386d913731e3e73679b856069';
const must=(v,m)=>{if(!v)throw Object.assign(Error(m),{safeReason:m});};
export function validatePlannedOriginal(old,fresh,{base,target}){
 must(old.kind==='shadowbridge-book-oauth-app-only-v1'&&old.installerRelease===originalOperator&&old.phase==='PLANNED'&&old.release===target&&old.previousRelease===base&&old.schemaChanged===false,'Only original 53cc1ae PLANNED checkpoint qualifies.');
 must(!old.image&&!old.configHashes&&!old.backups&&!old.bundle&&!old.ownerInteractiveAcceptance,'Original checkpoint progressed beyond the diagnosed stop.');
 for(const key of ['sourceDirectory','previousImage','acceptanceHash','appEnvironmentHash','appHost','appMounts','appNetworks'])must(same(old[key],fresh[key]),'Original preflight evidence no longer matches actual production.');
 const order=v=>[...v].sort((a,b)=>a.id.localeCompare(b.id));
 must(Array.isArray(old.protected)&&old.protected.length>0&&same(order(old.protected),order(fresh.protected)),'Protected services changed since original preparation.');
}
export function validateBuiltArtifacts(app,rollback,{image,previousImage,target,base}){
 must(/^sha256:[a-f0-9]{64}$/.test(image)&&/^sha256:[a-f0-9]{64}$/.test(previousImage)&&image!==previousImage,'Immutable distinct old/new image identities required.');
 for(const [actual,id,release]of [[app,image,target],[rollback,previousImage,base]])must(same(actual,{services:{app:{image:id,environment:{RELEASE_SHA:release}}}}),'Existing app/rollback overlay is not the exact approved payload.');
}
export async function recoverPlannedFlow(ops){
 let s=await ops.load();
 if(!s){const original=await ops.original();const fresh=await ops.preflight();s=await ops.adopt(original,fresh);s.phase='RECOVERY_VALIDATED';s.schemaChanged=false;await ops.save(s);}
 must(['RECOVERY_VALIDATED','BACKUPS_IN_PROGRESS'].includes(s.phase),'Recovery must not repeat a completed or unknown phase.');
 await ops.check(s);await ops.ownerMfa();s.phase='BACKUPS_IN_PROGRESS';await ops.save(s);
 await ops.backup(s);await ops.verifyBackups(s);s.phase='BACKUPS_VERIFIED_WAITING_OFFSITE';await ops.save(s);return s;
}
export async function checkpointedPair(ops,s,name,expected,{create,verify}){
 s.backups??={};s.backupStages??={};
 if(s.backups[name]){must(same(s.backups[name],expected),'Recorded backup paths changed.');await verify(expected);return expected;}
 const stage=s.backupStages[name];
 must(!stage||stage.phase==='CREATING'&&same(stage.paths,expected),'Unknown backup checkpoint.');
 if(!stage){must(!await ops.anyArtifacts(expected),'Unrecorded backup artifacts; nothing overwritten.');s.backupStages[name]={phase:'CREATING',paths:expected};await ops.save(s);}
 let pair;
 if(await ops.completePair(expected))pair=expected;
 else{must(!await ops.anyArtifacts(expected),'Partial backup retained; operator review required, nothing overwritten.');pair=await create();}
 must(same(pair,expected),'Backup generator returned unexpected paths.');await verify(pair);
 s.backups[name]=pair;s.backupStages[name]={phase:'VERIFIED',paths:expected};await ops.save(s);return pair;
}
