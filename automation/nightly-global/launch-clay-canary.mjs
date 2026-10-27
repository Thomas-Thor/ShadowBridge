// OWNER Pop!_OS only. Pinned public code + PRIVATE locally generated bindings.
// Installs the existing bounded receiver and tests CRM READ; not a Clay search.
import {mkdir,lstat,realpath,readFile,writeFile,statfs} from 'node:fs/promises';
import {homedir,hostname} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const must=(v,c)=>{if(!v)throw Error(c);};
const sha=v=>createHash('sha256').update(v).digest('hex');
export const assets=Object.freeze({
 'clay-sheets-canary.mjs':'6d18d3665766a312ab71a7af2572f1f604db67b74b7f529ec2f0f73289437319',
 'build-clay-canary.mjs':'bfd8d2f35059e5cc2c5921846c671c9cbf554975bfe99fba46266f84659ccc5c',
 'clay-canary-operator.mjs':'e5ba4bad5e2ba9a202e9fea0d172247be6d331164fa22a7c2c4e034d11f417ce',
 'n8n-contabo-transport.mjs':'416c84b0e9b1e70ff9cb355a6ad6c8bd78ee91837cf903b7552f379c6daccdcb',
});
async function download(url){
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 must(r.ok,'PINNED_CODE_DOWNLOAD_FAILED');const chunks=[];let size=0;
 for await(const b of r.body){size+=b.length;must(size<=1048576,'PINNED_CODE_TOO_LARGE');chunks.push(Buffer.from(b));}
 return Buffer.concat(chunks);
}
async function privateDirectory(dir){
 await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);
 must(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&511)===448&&await realpath(dir)===dir,'PRIVATE_PACKAGE_DIRECTORY_REQUIRED');
}
async function preserve(file,bytes){
 try{const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&511)===384,'PRIVATE_PACKAGE_FILE_REQUIRED');must(sha(await readFile(file))===sha(bytes),'PINNED_PACKAGE_CHANGED_NO_OVERWRITE');}
 catch(e){if(e.code!=='ENOENT')throw e;await writeFile(file,bytes,{mode:0o600,flag:'wx'});}
}
export async function launchCanary({release,projectId,googleId,spreadsheetId,sshTarget,root=path.join(homedir(),'.local/state/shadowbridge-sourcing-v1/deploy-packages'),get=download,run}={}){
 must(hostname()!=='vmi3682957'&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','OWNER_COMPUTER_AND_TLS_REQUIRED');
 must(/^[a-f0-9]{40}$/.test(release||''),'FULL_SOURCE_RELEASE_REQUIRED');
 must([projectId,googleId].every(v=>/^[A-Za-z0-9_-]{1,100}$/.test(v||''))&&/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId||''),'PRIVATE_EXISTING_BINDINGS_REQUIRED');
 must(path.isAbsolute(root),'PRIVATE_PACKAGE_PATH_REQUIRED');await privateDirectory(root);
 const space=await statfs(root);must(space.bavail*space.bsize>=16*1024*1024,'LOCAL_PACKAGE_SPACE_INSUFFICIENT');
 const dir=path.join(root,release);await privateDirectory(dir);
 // Fetch/check ALL modules before any import. Cached modules are also hashed.
 for(const [file,digest] of Object.entries(assets)){
  let bytes;try{const s=await lstat(path.join(dir,file));must(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&511)===384,'PRIVATE_PACKAGE_FILE_REQUIRED');bytes=await readFile(path.join(dir,file));}catch(e){if(e.code!=='ENOENT')throw e;bytes=await get('https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/'+release+'/automation/nightly-global/'+file);}
  must(sha(bytes)===digest,'PINNED_CODE_HASH_MISMATCH');await preserve(path.join(dir,file),bytes);
 }
 const {buildClayCanary}=await import(pathToFileURL(path.join(dir,'build-clay-canary.mjs')));
 const template=buildClayCanary({spreadsheetId,googleCredentialId:googleId});
 for(const n of template.nodes)if(n.credentials?.googleSheetsOAuth2Api)n.credentials.googleSheetsOAuth2Api.name='Google Sheets account';
 const bytes=Buffer.from(JSON.stringify(template,null,2)+'\n'),file=path.join(dir,'private-workflow.json');await preserve(file,bytes);
 const args=['--install','--workflow='+file,'--sha256='+sha(bytes),'--project='+projectId];
 if(sshTarget)args.push('--ssh='+sshTarget);
 if(run)return run({dir,args});
 const {main}=await import(pathToFileURL(path.join(dir,'clay-canary-operator.mjs')));return main(args);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),arg=k=>args.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3);
 launchCanary({release:arg('release'),projectId:arg('project'),googleId:arg('google'),spreadsheetId:arg('crm'),sshTarget:arg('ssh')}).catch(e=>{
  console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]{4,120}$/.test(e.message||'')?e.message:'CANARY_INTERRUPTED_CHECK_PRIVATE_CHECKPOINT',stage:/^[a-z.]{4,70}$/.test(e.stage||'')?e.stage:'operator',httpStatus:e.httpStatus??null,...(/^[A-Za-z0-9_-]{1,100}$/.test(e.workflowId||'')?{workflowId:e.workflowId,workflowUrl:'https://automation.shadow-bridge.eu/workflow/'+e.workflowId}:{}),checkpointRetained:true,automaticRetry:false,noLiveSourcingClaimed:true}));process.exitCode=1;
 });
}
