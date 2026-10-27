// Run on the OWNER computer. Reuses the existing workflow, OAuth and SSH.
// Default: inspect + backup + five-row canary/replay + remaining backed-up profiles.
import {mkdir,lstat,realpath,readFile,writeFile,statfs} from 'node:fs/promises';
import {homedir,hostname} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const must=(v,c)=>{if(!v)throw Error(c);};
const hash=v=>createHash('sha256').update(v).digest('hex');
export const assets=Object.freeze({
  'central-crm-sync-core.mjs': '3260ba233ac3b579ac81673f80361ea6650ff605e26b39d2b3078941d9405688',
  'build-central-crm-sync.mjs': 'b25a6c9c5fbbd1a3983c7df31afa0c6c8d639166043c9583bdc01c74476f3dce',
  'central-crm-sync-transport.mjs': '2e17bcf4c4fee9319ecc281ded431ba0366f418da0d3ef4ca3b4f720a8c6fe4b',
  'central-crm-backup-input.mjs': '07c0d1e83adc334128d01e56da797c720e4100da3a7f91cac748d8cdd739b769',
  'central-crm-sync-operator.mjs': '3a7a9b75fb562e4a613aebb0aea0aff310273aec9e3a13cd7a5c2873f99ae1b5',
  'build-clay-canary.mjs': 'bfd8d2f35059e5cc2c5921846c671c9cbf554975bfe99fba46266f84659ccc5c',
  'clay-sheets-canary.mjs': '6d18d3665766a312ab71a7af2572f1f604db67b74b7f529ec2f0f73289437319',
  'n8n-workflow-graph.mjs': 'c511e17824d792fb9325773c61bb969e872d2671c8ffa291a0d51fe1ab77d47a',
});
async function directory(dir){
  await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);
  must(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&511)===448&&await realpath(dir)===dir,'CRM_SYNC_PRIVATE_PACKAGE_DIRECTORY_REQUIRED');
}
async function download(url){
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  must(r.ok,'CRM_SYNC_PUBLIC_CODE_DOWNLOAD_FAILED');const parts=[];let count=0;
  for await(const part of r.body){count+=part.length;must(count<=2097152,'CRM_SYNC_PUBLIC_CODE_TOO_LARGE');parts.push(Buffer.from(part));}
  return Buffer.concat(parts);
}
export async function launch({release,projectId,googleId,spreadsheetId,sshTarget,backupRepository,backupManifestSha,backupManifestFile,restoreOnly=false,
  root=path.join(homedir(),'.local/state/shadowbridge-sourcing-v1/central-crm-packages'),get=download,run}={}){
  must(Number(process.versions.node.split('.')[0])>=22&&hostname()!=='vmi3682957'&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','CRM_SYNC_OWNER_NODE22_AND_TLS_REQUIRED');
  must(/^[a-f0-9]{40}$/.test(release||''),'CRM_SYNC_PINNED_RELEASE_REQUIRED');
  for(const value of [projectId,googleId,spreadsheetId])must(/^[A-Za-z0-9_-]{1,100}$/.test(value||''),'CRM_SYNC_PRIVATE_BINDINGS_REQUIRED');
  must(/^[a-z][a-z0-9_-]{0,31}@[A-Za-z0-9.-]{1,253}$/.test(sshTarget||''),'CRM_SYNC_AUTHORIZED_SSH_REQUIRED');
  must(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(backupRepository||'')&&/^[a-f0-9]{40}$/.test(backupManifestSha||''),'CRM_SYNC_PINNED_PRIVATE_MANIFEST_REQUIRED');
  must(path.isAbsolute(root),'CRM_SYNC_ABSOLUTE_PRIVATE_PATH_REQUIRED');await directory(root);
  const free=await statfs(root);must(free.bavail*free.bsize>=32*1024*1024,'CRM_SYNC_LOCAL_DISK_SPACE_INSUFFICIENT');
  const dir=path.join(root,release);await directory(dir);
  must(Object.keys(assets).length===8,'CRM_SYNC_ASSET_MANIFEST_INCOMPLETE');
  for(const [name,digest] of Object.entries(assets)){
    const file=path.join(dir,name);let bytes,cached=false;
    try{const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&511)===384,'CRM_SYNC_PRIVATE_PACKAGE_FILE_REQUIRED');bytes=await readFile(file);cached=true;}
    catch(e){if(e.code!=='ENOENT')throw e;bytes=await get('https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/'+release+'/automation/nightly-global/'+name);}
    must(hash(bytes)===digest,'CRM_SYNC_PINNED_CODE_HASH_MISMATCH');
    if(!cached)await writeFile(file,bytes,{mode:0o600,flag:'wx'});
  }
  const options={release,projectId,googleId,spreadsheetId,sshTarget,backupRepository,backupManifestSha,backupManifestFile,restoreOnly};
  if(run)return run({dir,options});
  const {main}=await import(pathToFileURL(path.join(dir,'central-crm-sync-operator.mjs')));return main(options);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),arg=k=>args.find(v=>v.startsWith('--'+k+'='))?.slice(k.length+3);
  launch({release:arg('release'),projectId:arg('project'),googleId:arg('google'),spreadsheetId:arg('crm'),sshTarget:arg('ssh'),backupRepository:arg('backup-repo'),backupManifestSha:arg('backup-manifest'),backupManifestFile:arg('backup-manifest-file'),restoreOnly:args.includes('--restore-workflow')}).catch(e=>{
    console.error(JSON.stringify({status:'BLOCKED',reason:/^(?:CRM_SYNC_|GOOGLE_SHEETS_)[A-Z0-9_]{1,110}$/.test(e.message||'')?e.message:'CRM_SYNC_INTERRUPTED_CHECK_PRIVATE_CHECKPOINT',
      stage:/^[a-z.]{1,60}$/.test(e.stage||'')?e.stage:'operator',httpStatus:e.httpStatus??null,automaticRetry:false,checkpointRetained:true,liveSourcingClaimed:false}));process.exitCode=1;
  });
}
