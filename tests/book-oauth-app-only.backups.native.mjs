// Actual encrypted companion archives and online certificate copy in own lab.
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import path from 'node:path';
import {backupLiveCertificates,encryptedTar} from '../scripts/book-oauth-app-only.mjs';import {verifiedTar} from '../scripts/r1-production-release.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');assert.ok(process.env.PATH.startsWith('/tmp/shadowbridge-r1-isolated/app-only-bin:'));
const folder=path.join(process.cwd(),'.local','app-only-certificate-test-'+randomUUID());await mkdir(folder,{mode:0o700});
const docker=args=>execFileSync('docker',['--context','default',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const id=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-gateway-1']))[0].Id;
const before=JSON.parse(docker(['inspect',id]))[0];assert.equal(before.State.Running,true);
const backup=await backupLiveCertificates(id,path.join(folder,'certificates'));assert.equal((await verifiedTar(backup.pair,{files:backup.files})).authenticated,true);
const after=JSON.parse(docker(['inspect',id]))[0];assert.equal(after.Id,before.Id);assert.equal(after.State.StartedAt,before.State.StartedAt);assert.equal(after.State.Running,true);
await writeFile(path.join(folder,'fictional-configuration.json'),JSON.stringify({fictional:true,noProductionSecrets:true}),{mode:0o600});
const sum=createHash('sha256').update(await readFile(path.join(folder,'fictional-configuration.json'))).digest('hex');
const pair=await encryptedTar(path.join(folder,'configuration'),folder,['fictional-configuration.json']);assert.equal((await verifiedTar(pair,{files:{'fictional-configuration.json':sum}})).authenticated,true);
await assert.rejects(verifiedTar(pair,{files:{'fictional-configuration.json':'0'.repeat(64)}}));
await writeFile(path.join(folder,'results.json'),JSON.stringify({result:'PASS',gatewayRestarted:false,onlineCertificateArchiveAuthenticated:true,configurationArchiveAuthenticated:true,mismatchRejected:true,productionChanged:false,testScratchOwnershipAdjustedOnly:true})+'\n',{mode:0o600});
console.log('PASS actual online certificate copy/GCM archive, configuration archive and checksum mismatch denial; gateway not restarted');console.log('CHECKPOINT '+folder);
