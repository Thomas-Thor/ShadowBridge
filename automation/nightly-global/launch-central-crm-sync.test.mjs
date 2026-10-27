import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assets,launch} from './launch-central-crm-sync.mjs';
const options={release:'1'.repeat(40),projectId:'fictional_project',googleId:'fictional_google',spreadsheetId:'fictional_spreadsheet',sshTarget:'fictional@host.example',backupRepository:'fictional/private-operations',backupManifestSha:'2'.repeat(40),backupManifestFile:'/tmp/fictional-private-manifest.json',restoreOnly:false};
test('every bundled module matches the manifest and the complete package is verified before execution',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sb-crm-package-'));const fetched=[];let ran=false;
  try{
    for(const [name,digest] of Object.entries(assets))assert.equal(createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex'),digest,name);
    const result=await launch({...options,root,get:async url=>{const name=url.split('/').at(-1);fetched.push(name);return readFile(new URL(name,import.meta.url));},run:({options:got})=>{ran=true;assert.deepEqual(got,options);return 'verified';}});
    assert.equal(result,'verified');assert.equal(ran,true);assert.equal(fetched.length,8);
    await launch({...options,root,get:()=>{throw Error('unexpected refetch');},run:()=>{}});
    const file=path.join(root,options.release,Object.keys(assets)[0]);await writeFile(file,'tampered',{mode:0o600});
    await assert.rejects(launch({...options,root,run:()=>{throw Error('must not execute');}}),/HASH_MISMATCH/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('corrupt downloads and non-private cached files stop before execution',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sb-crm-package-'));
  try{
    await assert.rejects(launch({...options,root,get:async()=>Buffer.from('corrupt'),run:()=>{throw Error('must not execute');}}),/HASH_MISMATCH/);
    await launch({...options,root,get:async url=>readFile(new URL(url.split('/').at(-1),import.meta.url)),run:()=>{}});
    await chmod(path.join(root,options.release,Object.keys(assets)[0]),0o644);
    await assert.rejects(launch({...options,root,run:()=>{throw Error('must not execute');}}),/PRIVATE_PACKAGE_FILE/);
  }finally{await rm(root,{recursive:true,force:true});}
});
