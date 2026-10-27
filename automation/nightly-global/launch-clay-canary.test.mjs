import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,lstat,chmod} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {launchCanary,assets} from './launch-clay-canary.mjs';
const options={release:'a'.repeat(40),projectId:'fictionalProject',googleId:'fictionalGoogle',spreadsheetId:'fictionalPrivateSpreadsheet12345'};
const fixture=async()=>{const root=await mkdtemp(path.join(tmpdir(),'sb-clay-launch-test-')),seen=[],run=async v=>{seen.push(v);return'NOT_A_LIVE_DEPLOYMENT';},get=async u=>{const file=u.split('/').at(-1);assert.ok(Object.hasOwn(assets,file));return readFile(new URL(file,import.meta.url));};return{...options,root,seen,run,get};};
test('pinned modules bind one existing private CRM/project/Google credential and invoke the installer once without source calls',async()=>{
 const f=await fixture();assert.equal(await launchCanary(f),'NOT_A_LIVE_DEPLOYMENT');assert.equal(f.seen.length,1);const {dir,args}=f.seen[0],w=JSON.parse(await readFile(path.join(dir,'private-workflow.json'),'utf8'));
 assert.equal(w.active,false);assert.equal(w.name,'ShadowBridge Global B2B Sourcing V1');assert.ok(args.includes('--project='+options.projectId));assert.ok(w.nodes.filter(n=>n.credentials?.googleSheetsOAuth2Api).every(n=>n.credentials.googleSheetsOAuth2Api.id===options.googleId));assert.equal((await lstat(path.join(dir,'private-workflow.json'))).mode&511,384);
 const again={...f,sshTarget:'operator@fictional.example.invalid',ownerProvidedBinding:true,get:async()=>{throw Error('CACHED_CODE_MUST_NOT_REDOWNLOAD');}};await launchCanary(again);assert.equal(f.seen.length,2);assert.ok(f.seen[1].args.includes('--ssh=operator@fictional.example.invalid'));assert.ok(f.seen[1].args.includes('--known-google-binding'));
});
test('tampered download is rejected before import/install and a damaged cache is never overwritten',async()=>{
 const f=await fixture();await assert.rejects(launchCanary({...f,get:async()=>Buffer.from('untrusted code')}),/HASH_MISMATCH/);assert.equal(f.seen.length,0);
 await launchCanary(f);const target=path.join(f.seen[0].dir,'clay-canary-operator.mjs');await writeFile(target,'CHANGED');await assert.rejects(launchCanary(f),/HASH_MISMATCH/);assert.equal(await readFile(target,'utf8'),'CHANGED');assert.equal(f.seen.length,1);
});
test('invalid bindings or unsafe package permissions stop before any installation',async()=>{
 const f=await fixture();await assert.rejects(launchCanary({...f,release:'short'}),/FULL_SOURCE_RELEASE/);await chmod(f.root,0o755);await assert.rejects(launchCanary(f),/PRIVATE_PACKAGE_DIRECTORY/);assert.equal(f.seen.length,0);
});
test('all launcher dependency hashes match committed code',async()=>{
 for(const [file,digest]of Object.entries(assets))assert.equal(createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex'),digest,file);
});
