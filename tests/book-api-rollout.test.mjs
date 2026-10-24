import test from 'node:test';import assert from 'node:assert/strict';import{readFile,readdir,writeFile}from'node:fs/promises';import{randomBytes,createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{ownerBookR1,baseline,evaluateInventory,safeHttpEvidence,pinnedR1Runtime,catalog}from'../scripts/international-r1-diagnose.mjs';
import{prepareApplicationPlan,checkApplicationPlan,checkMergedApplication,disabledApplicationArguments,backupApplicationConfiguration}from'../scripts/international-r1.mjs';
import{verifiedTar}from'../scripts/r1-production-release.mjs';import path from'node:path';
import{checkProduction}from'../scripts/production-config.mjs';import{repositoryRoot}from'../scripts/staging-prepare.mjs';import{bootstrap}from'../scripts/r1-owner-deploy.mjs';import{ownerBookPluginContract}from'../scripts/owner-book-contract.mjs';
const good=()=>({legacyPublicGateway:false,installation:{unique:true},repository:{trackedClean:true,untrackedCount:0},application:{release:ownerBookR1,sourceMatchesBaseline:true,internalAuthTlsVerified:true,ownerBookApiEnabled:false},profiles:{valid:true,gatewayMounted:true,gatewayState:'active',runtimeConfigurationMatchesProfile:true},network:{internal:true,gatewayConnected:true,n8nConnected:true,webhookUrlCorrect:true},privatePorts:true,database:{migrationPrefixValid:true,migrationCount:18,activeOwnersWithVerifiedTotp:1},domains:{main:{ok:true},automation:{ok:true},automationSignIn:{ok:true},dnsMatchesExpected:true},disk:{enoughForBuildAndBackup:true}});
test('R1 preflight requires exact d558 runtime, all 18 migrations, prior disabled API and every original guard',()=>{
 assert.equal(evaluateInventory(good(),{runtimeRelease:ownerBookR1}).status,'READY FOR PREFLIGHT');assert.equal(evaluateInventory(good()).status,'BLOCKED');
 for(const change of [r=>r.application.release=baseline,r=>r.application.sourceMatchesBaseline=false,r=>r.database.migrationCount=17,r=>r.application.ownerBookApiEnabled=true,r=>r.database.activeOwnersWithVerifiedTotp=0,r=>r.profiles.valid=false,r=>r.profiles.runtimeConfigurationMatchesProfile=false,r=>r.privatePorts=false]){const r=good();change(r);assert.equal(evaluateInventory(r,{runtimeRelease:ownerBookR1}).status,'BLOCKED');}
 assert.throws(()=>evaluateInventory(good(),{runtimeRelease:'a'.repeat(40)}));
});
test('all 67 expected image files come from immutable R1 Git objects, including binary assets',async()=>{
 const expected=await pinnedR1Runtime(repositoryRoot);assert.equal(Object.keys(expected).length,67);for(const[file,hash]of Object.entries(expected))assert.equal(createHash('sha256').update(execFileSync('git',['show',ownerBookR1+':'+file])).digest('hex'),hash);
 assert.equal(catalog.migrations.length,18);const h={status:200,authorized:true,headers:{'x-shadowbridge-release':ownerBookR1},body:{ok:true}};assert.equal(safeHttpEvidence(h,'main',{expectedRelease:ownerBookR1}).ok,true);assert.equal(safeHttpEvidence(h,'main').ok,false);
});
test('operator bootstrap explicitly requests R1 runtime verification; no legacy baseline or schema reset is substituted',()=>{
 const shell=bootstrap('a'.repeat(40),{bookApi:true});execFileSync('sh',['-n'],{input:shell});assert.ok(shell.includes('--runtime='+ownerBookR1));assert.ok(shell.includes(' --book-api'));assert.ok(!/reset|force|prune|down -v/.test(shell));
});
test('an explicit R1 update plan preserves fingerprints; independent API-off override cannot alter other services',async()=>{
 const dirs=(await readdir(repositoryRoot+'/.local')).filter(n=>/^r1-plan-test-/.test(n));assert.ok(dirs.length,'Run the existing R1 planning case first');const source=repositoryRoot+'/.local/'+dirs.at(-1),profile=await checkProduction({directory:source});
 const image='sha256:'+'c'.repeat(64),previousImage='sha256:'+'b'.repeat(64),sha=randomBytes(20).toString('hex');
 await assert.rejects(prepareApplicationPlan({profile,image,previousImage,releaseSha:sha,previousReleaseSha:ownerBookR1,ownerBookApi:true}));
 try{await readFile(profile.sourceDirectory+'/international-r1/'+ownerBookR1+'/plan.json');}catch(e){if(e.code!=='ENOENT')throw e;await prepareApplicationPlan({profile,image:previousImage,previousImage:'sha256:'+'a'.repeat(64),releaseSha:ownerBookR1,previousReleaseSha:baseline,ownerBookApi:false});}
 const plan=await prepareApplicationPlan({profile,image,previousImage,releaseSha:sha,previousReleaseSha:ownerBookR1,expectedPreviousReleaseSha:ownerBookR1,ownerBookApi:true,previousOwnerBookApi:false});
 assert.ok(Object.keys(plan.plan.fingerprints).some(f=>f.endsWith('/'+ownerBookR1+'/application.json')),'Current R1 override must be included in configuration backup');
 assert.equal((await checkApplicationPlan({profile,directory:plan.directory})).previousReleaseSha,ownerBookR1);checkMergedApplication(profile,plan.directory,plan.plan);
 const backup=await backupApplicationConfiguration({profile,directory:plan.directory}),files=Object.fromEntries(Object.entries(plan.plan.fingerprints).filter(([f])=>f.startsWith(profile.sourceDirectory+path.sep)).map(([f,h])=>[path.relative(profile.sourceDirectory,f),h]));assert.equal((await verifiedTar(backup,{files})).authenticated,true);
 const args=disabledApplicationArguments(profile,plan.directory);assert.ok(args.includes('--no-deps'));assert.ok(args.includes('--no-build'));assert.equal(args.at(-1),'app');assert.ok(args.includes(profile.gatewayOverride));
 const file=plan.directory+'/disabled.json';await writeFile(file,JSON.stringify({services:{app:{image,environment:{RELEASE_SHA:sha,OWNER_BOOK_API_ENABLED:'false'}},auth:{image:'forbidden'}}}),{mode:0o600});await assert.rejects(checkApplicationPlan({profile,directory:plan.directory}));
});
test('plugin HTTP schema is explicitly unverified, requires confirmed JSON writes and excludes admin/import scopes',async()=>{
 const c=ownerBookPluginContract();assert.equal(c['x-shadowbridge-platform-status'],'UNVERIFIED_NOT_CONNECTED');assert.deepEqual(c,JSON.parse(await readFile(new URL('../docs/owner-book.plugin.openapi.json',import.meta.url))));
 assert.ok(!Object.keys(c.paths).some(p=>/keys|crm|vault|import|accounts/.test(p)));
 for(const p of Object.values(c.paths))for(const[method,op]of Object.entries(p))if(method!=='get'){assert.equal(op['x-openai-isConsequential'],true);assert.ok(op.requestBody.content['application/json'].schema.required.includes('explicitWrite'));assert.equal(op.requestBody.content['application/json'].schema.properties.explicitWrite.const,true);}
});
