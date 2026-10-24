import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pins,verifiedScript,readinessCommand,summarizeReadiness,publicEvidence} from './owner-next-step.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

test('launcher pins existing independent releases; acquisition code is never deployed over Book',async()=>{
 const installer=execFileSync('git',['show',pins.release+':scripts/r1-owner-deploy.mjs']);
 assert.equal(sha(installer),pins.installerSha256);
 const collector=execFileSync('git',['show',pins.readinessRelease+':automation/nightly-global/collect-readiness.mjs']);
 assert.equal(sha(collector),pins.readinessSha256);
 assert.deepEqual(collector,await readFile(new URL('./collect-readiness.mjs',import.meta.url)));
 const runtime=execFileSync('git',['show',pins.release+':server/app.mjs'],{encoding:'utf8'});
 assert.ok(runtime.includes('owner-book.mjs'));assert.ok(!runtime.includes('acquisition-gateway.mjs'));
});
test('download refuses changed bytes, unpinned URL and redirects; no real fetch is made',async()=>{
 let calls=0;const url='https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/'+pins.release+'/scripts/r1-owner-deploy.mjs';
 const fetcher=async(u,o)=>{calls++;assert.equal(o.redirect,'error');return new Response('fixture only');};
 assert.equal((await verifiedScript(url,sha('fixture only'),fetcher)).toString(),'fixture only');
 await assert.rejects(verifiedScript(url,'0'.repeat(64),fetcher));
 await assert.rejects(verifiedScript(url.replace(pins.release,'main'),sha('fixture only'),fetcher));
 assert.equal(calls,2);
 await assert.rejects(verifiedScript(url,sha('fixture only'),async()=>new Response(null,{status:302})));
});
test('SSH inventory script is syntactically valid, exact-host read-only and has no credential prompt',()=>{
 const bytes=execFileSync('git',['show',pins.readinessRelease+':automation/nightly-global/collect-readiness.mjs']);
 const cmd=readinessCommand(bytes);execFileSync('sh',['-n'],{input:cmd});
 assert.ok(cmd.includes('test "$(hostname)" = vmi3682957'));
 assert.ok(cmd.includes('node "$SB_READONLY_FILE" </dev/null'));
 assert.ok(cmd.includes('sha256sum --check --status'));
 assert.ok(!/sudo|compose|prune|git reset|docker stop|--apply/.test(cmd));
 assert.throws(()=>readinessCommand(Buffer.from('changed')));
});
test('public checks use JSON for API and HTML for signin, never infer authorized read from a 401',async()=>{
 const calls=[];
 const result=await publicEvidence(async(u,o)=>{
  calls.push(u);assert.equal(o.redirect,'error');assert.deepEqual(Object.keys(o.headers),['Accept']);
  let data={ok:true},status=200;
  const headers={'X-ShadowBridge-Release':pins.release,'Content-Type':'application/json'};
  if(u.endsWith('/signin')){assert.equal(o.headers.Accept,'text/html');return new Response('<html>Fictional login</html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});}
  assert.equal(o.headers.Accept,'application/json');
  if(u.endsWith('/healthz'))data={status:'ok'};
  if(u.endsWith('/api/config'))data={backendEnabled:true,releaseSha:pins.release,csrfToken:'DO_NOT_EXPORT'};
  if(u.includes('/entries?')){status=401;data={code:'BOOK_API_DENIED'};}
  return new Response(JSON.stringify(data),{status,headers});
 });
 assert.equal(calls.length,5);assert.equal(result.bookAnonymousGateVerified,true);assert.equal(result.authorizedBookReadVerified,false);
 assert.equal(result.chatgptConnected,false);assert.equal(result.n8nSignInHtmlVerified,true);assert.equal(result.n8nHealthVerified,true);
 assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));
});
test('unreachable, disabled or unexpected production never claims enabled API or successful TLS',async()=>{
 const denied=await publicEvidence(async()=>{throw Error('proxy blocked');});
 assert.equal(denied.healthStatus,null);assert.equal(denied.releaseVerified,false);assert.equal(denied.bookAnonymousGateVerified,false);
 const disabled=await publicEvidence(async()=>new Response(JSON.stringify({code:'BOOK_API_DISABLED'}),{status:503}));
 assert.equal(disabled.bookKnownDisabled,true);assert.equal(disabled.bookAnonymousGateVerified,false);
 const unknown=await publicEvidence(async()=>new Response('{"ok":true}',{headers:{'X-ShadowBridge-Release':pins.previousRelease}}));
 assert.equal(unknown.releaseVerified,false);assert.equal(unknown.bookAnonymousGateVerified,false);
});
test('n8n summary omits raw workflow records, keys, paths, and never infers account quotas',()=>{
 const source={readOnly:true,changesMade:false,n8n:{container:'shadowbridge-automation-n8n-1',running:true,healthOk:true,version:'2.44.6',publicApi:{keySupplied:false},providerReferences:{apollo:2,clay:1,relevance:4},workflowCountInspected:0,secret:'DO_NOT_EXPORT',workflows:['DO_NOT_EXPORT']}};
 const r=summarizeReadiness(source);assert.equal(r.status,'EXISTING_N8N_OBSERVED');assert.equal(r.crmMachineSinkVerified,false);assert.equal(r.providerCreditsVerified,false);assert.equal(r.providerApiEntitlementsVerified,false);assert.ok(!JSON.stringify(r).includes('DO_NOT_EXPORT'));
 assert.equal(summarizeReadiness({...source,changesMade:true}).status,'UNVERIFIED');
 assert.equal(summarizeReadiness({}).status,'UNVERIFIED');
});
test('default launch is dry, and production apply is refused without a private terminal',()=>{
 const file=new URL('./owner-next-step.mjs',import.meta.url).pathname;
 const dry=spawnSync(process.execPath,[file],{encoding:'utf8'});assert.equal(dry.status,0);const r=JSON.parse(dry.stdout);assert.equal(r.status,'DRY_RUN_NO_NETWORK');assert.equal(r.crmWrites,0);assert.equal(r.workflowActivation,false);
 const apply=spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8'});assert.equal(apply.status,2);assert.ok(apply.stderr.includes('STOP'));assert.equal(apply.stdout,'');
});
