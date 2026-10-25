import test from 'node:test';import assert from 'node:assert/strict';import path from'node:path';
import{readFile,writeFile,mkdir}from'node:fs/promises';import{randomBytes,createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{prepareStaging,repositoryRoot}from'../scripts/staging-prepare.mjs';import{prepareProduction,checkProduction}from'../scripts/production-config.mjs';
import{productionBase,prepareGatewayProfile,saveGatewayState}from'../scripts/n8n-gateway-profile.mjs';
import{ownerBookR1,ownerBookApiR1,evaluateInventory,pinnedR1Runtime}from'../scripts/international-r1-diagnose.mjs';
import{prepareApplicationPlan,checkApplicationPlan,checkMergedApplication,disabledApplicationArguments,backupApplicationConfiguration,applicationBackupFiles}from'../scripts/international-r1.mjs';
import{verifiedTar,runRelease,assertNoOtherReleaseLock}from'../scripts/r1-production-release.mjs';import{bootstrap}from'../scripts/r1-owner-deploy.mjs';
test('accepted API base requires unchanged 236 runtime, API on, MCP off and the complete ledger',async()=>{
 const r={installation:{unique:true},repository:{trackedClean:true,untrackedCount:0},application:{release:ownerBookApiR1,sourceMatchesBaseline:true,internalAuthTlsVerified:true,ownerBookApiEnabled:true,ownerBookMcpEnabled:false},profiles:{valid:true,gatewayMounted:true,gatewayState:'active',runtimeConfigurationMatchesProfile:true},network:{internal:true,gatewayConnected:true,n8nConnected:true,webhookUrlCorrect:true},privatePorts:true,database:{migrationPrefixValid:true,migrationCount:18,activeOwnersWithVerifiedTotp:1},domains:{main:{ok:true},automation:{ok:true},automationSignIn:{ok:true},dnsMatchesExpected:true},disk:{enoughForBuildAndBackup:true}};
 assert.equal(evaluateInventory(r,{runtimeRelease:ownerBookApiR1}).status,'READY FOR PREFLIGHT');
 for(const change of [x=>x.application.ownerBookApiEnabled=false,x=>x.application.ownerBookMcpEnabled=true,x=>x.database.migrationCount=17,x=>x.application.sourceMatchesBaseline=false]){const bad=structuredClone(r);change(bad);assert.equal(evaluateInventory(bad,{runtimeRelease:ownerBookApiR1}).status,'BLOCKED');}
 const hashes=await pinnedR1Runtime(repositoryRoot,ownerBookApiR1);assert.equal(Object.keys(hashes).length,67);for(const[f,h]of Object.entries(hashes))assert.equal(createHash('sha256').update(execFileSync('git',['show',ownerBookApiR1+':'+f])).digest('hex'),h);
});
test('MCP bootstrap is pinned, respects active locks and never calls the old release acceptance',()=>{
 const shell=bootstrap('a'.repeat(40),{bookMcp:true});execFileSync('sh',['-n'],{input:shell});assert.ok(shell.includes('--runtime='+ownerBookApiR1));assert.ok(shell.includes('feature/owner-book-mcp-readonly'));assert.ok(shell.includes('--book-mcp'));assert.ok(shell.includes('operation.lock'));assert.ok(!shell.includes(' accept '));assert.throws(()=>bootstrap('a'.repeat(40),{bookMcp:true,bookApi:true}));
});
test('actual Compose plans preserve REST on MCP enable/off/rollback and encrypted backup contains accepted checkpoint',async()=>{
 const id=randomBytes(5).toString('hex'),directory=path.join(repositoryRoot,'.local','mcp-plan-test-'+id);
 const staged=await prepareStaging({directory,project:'shadowbridge-stageg-mcpplan-'+id});let profile=await prepareProduction({directory:staged.directory,releaseSha:productionBase});await prepareGatewayProfile(profile);await saveGatewayState(profile,{phase:'active'});profile=await checkProduction({directory});
 const image=n=>'sha256:'+n.repeat(64);
 await prepareApplicationPlan({profile,image:image('b'),releaseSha:ownerBookR1,previousImage:image('a'),previousReleaseSha:productionBase,ownerBookApi:false});
 await prepareApplicationPlan({profile,image:image('c'),releaseSha:ownerBookApiR1,previousImage:image('b'),previousReleaseSha:ownerBookR1,expectedPreviousReleaseSha:ownerBookR1,ownerBookApi:true,previousOwnerBookApi:false});
 const previousAcceptance={release:ownerBookApiR1,purpose:'book-api',phase:'DEPLOYED_AND_VERIFIED',ownerInteractiveAcceptance:true,image:image('c'),sourceDirectory:profile.sourceDirectory};
 const opts={profile,image:image('d'),releaseSha:'e'.repeat(40),previousImage:image('c'),previousReleaseSha:ownerBookApiR1,expectedPreviousReleaseSha:ownerBookApiR1,ownerBookApi:true,previousOwnerBookApi:true,ownerBookMcp:true,previousAcceptance};
 for(const change of [x=>x.ownerBookApi=false,x=>x.previousOwnerBookApi=false,x=>x.previousOwnerBookMcp=true,x=>x.previousAcceptance={...previousAcceptance,ownerInteractiveAcceptance:false}]){const p={...opts};change(p);await assert.rejects(prepareApplicationPlan(p));}
 const result=await prepareApplicationPlan(opts),plan=await checkApplicationPlan({profile,directory:result.directory});checkMergedApplication(profile,result.directory,plan);
 const off=JSON.parse(await readFile(result.directory+'/mcp-disabled.json'));assert.equal(off.services.app.environment.OWNER_BOOK_API_ENABLED,'true');assert.equal(off.services.app.environment.OWNER_BOOK_MCP_ENABLED,'false');
 const rollback=JSON.parse(await readFile(result.directory+'/rollback.json'));assert.equal(rollback.services.app.environment.OWNER_BOOK_API_ENABLED,'true');assert.equal(rollback.services.app.environment.RELEASE_SHA,ownerBookApiR1);
 const args=disabledApplicationArguments(profile,result.directory,{mcpOnly:true});assert.ok(args.includes('--no-deps'));assert.ok(args.includes('--no-build'));assert.equal(args.at(-1),'app');
 const pair=await backupApplicationConfiguration({profile,directory:result.directory}),files=await applicationBackupFiles(profile,result.directory,plan);assert.ok(Object.keys(files).some(f=>f.endsWith('/previous-acceptance.json')));assert.equal((await verifiedTar(pair,{files})).authenticated,true);
 await writeFile(result.directory+'/mcp-disabled.json',JSON.stringify({services:{app:{environment:{OWNER_BOOK_API_ENABLED:'false'}}}}),{mode:0o600});await assert.rejects(checkApplicationPlan({profile,directory:result.directory}));
});
test('another release lock stops safely without deleting it; MCP coordinator refuses non-Contabo before mutations',async()=>{
 const root=path.join(repositoryRoot,'.local','mcp-lock-test-'+randomBytes(4).toString('hex'));await mkdir(root,{mode:0o700});const other=path.join(root,'r1-owner-release-'+ownerBookApiR1);await mkdir(other,{mode:0o700});await writeFile(other+'/operation.lock','fictional-pid',{mode:0o600});await assert.rejects(assertNoOtherReleaseLock(root,path.join(root,'own')));assert.equal(await readFile(other+'/operation.lock','utf8'),'fictional-pid');
 await assert.rejects(runRelease({phase:'prepare',release:'e'.repeat(40),bookMcp:true}),/wyłącznie przez sudo/);
});
