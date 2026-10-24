// Codex/developer disk guard. Read-only; no Docker cleanup or data deletion.
import {stat,statfs,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const MiB=1024**2;
export function spaceDecision({root,pool,sameFilesystem,dockerInPool,workspaceInPool,requiredMiB=8192,reserveMiB=2048,maxUsedMiB=12288}){
 const reasons=[];
 if(sameFilesystem)reasons.push('Heavy workspace is on the root filesystem');
 if(!dockerInPool)reasons.push('Docker data-root is outside the isolated temporary pool');
 if(workspaceInPool===false)reasons.push('Fixture checkout and backups are outside the temporary pool');
 if(root.freeBytes<128*MiB)reasons.push('Root metadata reserve is below 128 MiB');
 if(root.freeInodes<10000||pool.freeInodes<200000)reasons.push('Insufficient free inodes');
 if(pool.freeBytes<(requiredMiB+reserveMiB)*MiB)reasons.push('Insufficient temporary space plus reserve');
 if(pool.usedBytes>maxUsedMiB*MiB)reasons.push('Temporary filesystem usage exceeds the reviewed 12 GiB cap');
 return {result:reasons.length?'BLOCKED':'PASS',reasons,requiredMiB,reserveMiB,maxUsedMiB,rootMetadataReserveMiB:128};
}
export async function inspectSpace({directory='/tmp/shadowbridge-r1-isolated',dockerRoot,workspace=process.cwd()}={}){
 const target=await realpath(directory),temporary=await realpath('/tmp');
 if(!target.startsWith(temporary+path.sep))throw new Error('Heavy workspace must be a real directory below /tmp');
 const sample=async p=>{const [s,f]=await Promise.all([stat(p),statfs(p)]);return{device:s.dev,freeBytes:f.bavail*f.bsize,usedBytes:(f.blocks-f.bfree)*f.bsize,freeInodes:f.ffree};};
 const root=await sample('/'),pool=await sample(target);
 if(!dockerRoot)dockerRoot=execFileSync('docker',['info','--format','{{.DockerRootDir}}'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const actualDockerRoot=await realpath(dockerRoot);
 const dockerInPool=actualDockerRoot.startsWith(target+path.sep)&&(await stat(actualDockerRoot)).dev===pool.device;
 const checkout=await realpath(workspace),workspaceInPool=checkout.startsWith(target+path.sep)&&(await stat(checkout)).dev===pool.device;
 return {...spaceDecision({root,pool,sameFilesystem:root.device===pool.device,dockerInPool,workspaceInPool}),root,pool,directory:target,dockerInPool,workspaceInPool,readOnly:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.some(v=>!v.startsWith('--dir='))||args.length>1)throw new Error('Use only --dir=/tmp/your-isolated-workspace');
 inspectSpace({directory:args[0]?.slice(6)}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.result!=='PASS')process.exitCode=1;}).catch(()=>{console.error('BLOCKED: could not establish filesystem/Docker isolation. No test or cleanup started.');process.exitCode=1;});
}
