import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';import{readFile}from'node:fs/promises';
import{collectReadinessOnly}from'./owner-readiness-only.mjs';
import{pins}from'./owner-next-step.mjs';
const collector=()=>execFileSync('git',['show',pins.readinessRelease+':automation/nightly-global/collect-readiness.mjs']);
test('independent inventory cannot infer scope, credits, CRM delivery or scheduling from a healthy n8n',async()=>{
 let requests=0;const r=await collectReadinessOnly({readCollector:async()=>collector(),inspectN8n:async cmd=>{requests++;assert.ok(cmd.includes('</dev/null'));assert.ok(!cmd.includes('r1-production-release'));return {readOnly:true,changesMade:false,n8n:{container:'shadowbridge-automation-n8n-1',running:true,healthOk:true,publicApi:{keySupplied:false},providerReferences:{apollo:0,clay:0,relevance:0},workflowCountInspected:0}};},inspectPublic:async()=>({bookAnonymousGateVerified:true,authorizedBookReadVerified:false})});
 assert.equal(requests,1);assert.equal(r.n8n.status,'EXISTING_N8N_OBSERVED');assert.equal(r.status,'BLOCKED_FOR_CANARY');assert.equal(r.book.scopeSource,'NOT_READ');assert.equal(r.book.reportWritten,false);assert.equal(r.canary.startAt,null);assert.equal(r.canary.maxRecords,null);assert.equal(r.canary.maxCredits,0);assert.equal(r.canary.executed,false);assert.equal(r.productionUpdated,false);
});
test('tampered collector stops before SSH or public calls',async()=>{
 await assert.rejects(collectReadinessOnly({readCollector:async()=>Buffer.from('changed'),inspectN8n:async()=>assert.fail('SSH must not run'),inspectPublic:async()=>assert.fail('HTTP must not run')}));
});
test('unavailable SSH remains unverified and no installer is executed; default mode is offline',async()=>{
 const r=await collectReadinessOnly({readCollector:async()=>collector(),inspectN8n:async()=>({}),inspectPublic:async()=>({releaseVerified:false})});assert.equal(r.n8n.status,'UNVERIFIED');assert.equal(r.canary.executed,false);
 const file=new URL('./owner-readiness-only.mjs',import.meta.url),dry=spawnSync(process.execPath,[file.pathname],{encoding:'utf8'});assert.equal(dry.status,0);assert.equal(JSON.parse(dry.stdout).status,'DRY_RUN_NO_NETWORK');
 const code=await readFile(file,'utf8');assert.ok(!/r1-owner-deploy|r1-production-release|--apply/.test(code));
 const invalid=spawnSync(process.execPath,[file.pathname,'--apply'],{encoding:'utf8'});assert.equal(invalid.status,2);
});
