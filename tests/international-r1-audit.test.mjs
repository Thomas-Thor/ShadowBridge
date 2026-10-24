import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {baseline,catalog,evaluateInventory,safeContainer,safeHttpEvidence,diagnose,profileEvidence} from '../scripts/international-r1-diagnose.mjs';
import {spaceDecision,inspectSpace} from '../scripts/workspace-space.mjs';

const good=()=>({legacyPublicGateway:false,installation:{unique:true},repository:{trackedClean:true,untrackedCount:0},application:{release:baseline,sourceMatchesBaseline:true,internalAuthTlsVerified:true},profiles:{valid:true,gatewayMounted:true,gatewayState:'active',runtimeConfigurationMatchesProfile:true},network:{internal:true,gatewayConnected:true,n8nConnected:true,webhookUrlCorrect:true},privatePorts:true,database:{migrationPrefixValid:true,migrationCount:15,activeOwnersWithVerifiedTotp:1},domains:{main:{ok:true},automation:{ok:true},automationSignIn:{ok:true},dnsMatchesExpected:true},disk:{enoughForBuildAndBackup:true}});
test('a fully consistent inventory authorizes only preflight, never deployment',()=>{const r=evaluateInventory(good());assert.equal(r.status,'READY FOR PREFLIGHT');assert.equal(r.deploymentApproved,false);});
test('legacy public Caddy, private staging and manual/unapplied gateway require a compatibility stage',()=>{
 for(const mutate of [r=>r.legacyPublicGateway=true,r=>r.profiles.gatewayState='prepared',r=>r.profiles.valid=false,r=>r.profiles.gatewayMounted=false,r=>r.profiles.runtimeConfigurationMatchesProfile=false,r=>r.application.internalAuthTlsVerified=false]){const r=good();mutate(r);assert.equal(evaluateInventory(r).status,'BLOCKED');}
});
test('release, DB, OWNER, ports, TLS, ambiguous installations and dirty worktrees fail closed',()=>{
 for(const mutate of [r=>r.application.release='a'.repeat(40),r=>r.application.sourceMatchesBaseline=false,r=>r.database.migrationPrefixValid=false,r=>r.database.migrationCount=14,r=>r.database.activeOwnersWithVerifiedTotp=0,r=>r.privatePorts=false,r=>r.domains.main.ok=false,r=>r.domains.automationSignIn.ok=false,r=>r.installation.unique=false,r=>r.repository.untrackedCount=1,r=>r.disk.enoughForBuildAndBackup=false]){const r=good();mutate(r);assert.equal(evaluateInventory(r).status,'BLOCKED');}
});
test('safe inventory never returns container secrets, raw Env, addresses or member identifiers',()=>{
 const secret='FICTIONAL-PRIVATE-SECRET',value=safeContainer({Name:'/shadowbridge-test',State:{Running:true},Image:'sha256:'+'a'.repeat(64),Config:{Env:['DATABASE_URL='+secret,'RELEASE_SHA='+baseline,'GOTRUE_JWT_SECRET='+secret],Labels:{'private.client.name':secret}},HostConfig:{PortBindings:{'5678/tcp':[{HostIp:'127.0.0.1',HostPort:'5678'}]}},Mounts:[{Type:'bind',Source:'/private/'+secret,Destination:'/run/secrets/private'}]});
 assert.ok(!JSON.stringify(value).includes(secret));assert.equal(value.release,baseline);assert.equal(value.ports[0].host,'127.0.0.1');
});
test('HTTP evidence rejects invalid TLS, Basic Auth and wrong SHA without exposing cookies/CSRF/body',()=>{
 const v={status:200,authorized:true,headers:{'x-shadowbridge-release':baseline,'set-cookie':'SECRET-COOKIE'},body:{ok:true,csrfToken:'SECRET-CSRF',privateRecord:'SECRET-RECORD'}};
 assert.equal(safeHttpEvidence(v,'main').ok,true);assert.ok(!JSON.stringify(safeHttpEvidence(v,'main')).includes('SECRET'));
 for(const x of [{...v,authorized:false},{...v,headers:{...v.headers,'www-authenticate':'Basic'}},{...v,headers:{'x-shadowbridge-release':'b'.repeat(40)}}])assert.equal(safeHttpEvidence(x,'main').ok,false);
});
test('standalone migration/source catalog matches the immutable R1 files',async()=>{
 const digest=b=>createHash('sha256').update(b).digest('hex');
 const names=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort();assert.equal(names.length,17);
 assert.deepEqual(catalog.migrations,await Promise.all(names.map(async name=>({name,sha256:digest(await readFile(new URL('../supabase/migrations/'+name,import.meta.url)))}))));
 for(const file of ['deploy/production/compose.yaml','deploy/production/caddy-entrypoint.sh','deploy/production/Caddyfile.in'])assert.equal(catalog[file],digest(await readFile(new URL('../'+file,import.meta.url))));
 assert.equal(catalog.gatewayCaddy,digest(Buffer.concat(await Promise.all(['deploy/production/Caddyfile.in','deploy/automation/Caddyfile.append'].map(f=>readFile(new URL('../'+f,import.meta.url)))))));
});
test('all pinned baseline runtime checksums come from the actual 7f794a2 Git objects',()=>{
 assert.equal(Object.keys(catalog.baselineRuntime).length,61);
 for(const [file,digest]of Object.entries(catalog.baselineRuntime))assert.equal(createHash('sha256').update(execFileSync('git',['show',baseline+':'+file])).digest('hex'),digest);
});
test('diagnostic refuses the Codex/local owner installation before Docker or SQL',async()=>{await assert.rejects(diagnose({repo:new URL('..',import.meta.url).pathname}),/existing \/opt\/shadowbridge/);});
test('diagnostic is standalone and uses read-only transactions; no deployment/reset or file writes',async()=>{
 const s=await readFile(new URL('../scripts/international-r1-diagnose.mjs',import.meta.url),'utf8');assert.match(s,/BEGIN READ ONLY/);assert.match(s,/statement_timeout/);assert.ok(!/writeFile|appendFile|unlink|rmSync|shutil|method:\s*['"](?:POST|PUT|DELETE)/.test(s));assert.ok(!/from ['"]\.\.?\//.test(s));
});
test('standalone fingerprints accept an existing generated fictional profile and expose a wrong live Caddy mount',async()=>{
 const repo=new URL('..',import.meta.url).pathname.replace(/\/$/,''),base=repo+'/.local';
 const names=(await readdir(base)).filter(n=>/^r1-plan-test-[a-f0-9]{10}$/.test(n));assert.ok(names.length);
 const source=base+'/'+names.at(-1),manifest=JSON.parse(await readFile(source+'/manifest.json'));
 assert.match(manifest.project,/^shadowbridge-stageg-r1plan-/);
 const pg={Config:{Labels:{'com.docker.compose.project':manifest.project}},Mounts:[{Source:source+'/certs/postgres.crt',Destination:'/run/secrets/postgres.crt'}]},gateway={Mounts:[{Source:source+'/automation-gateway/Caddyfile',Destination:'/etc/caddy/Caddyfile'}]};
 const a=await profileEvidence(repo,pg,gateway);assert.equal(a.valid,true);assert.equal(a.gatewayState,'active');assert.equal(a.gatewayMounted,true);
 const b=await profileEvidence(repo,pg,{Mounts:[{Source:source+'/Caddyfile',Destination:'/etc/caddy/Caddyfile'}]});assert.equal(b.gatewayMounted,false);
});
const MiB=1024**2;
const space=()=>({root:{freeBytes:256*MiB,freeInodes:100000},pool:{freeBytes:14*1024*MiB,usedBytes:2*1024*MiB,freeInodes:1000000},sameFilesystem:false,dockerInPool:true,workspaceInPool:true});
test('resource budget accepts isolated tmp capacity but never root Docker as an alternative',()=>{
 assert.equal(spaceDecision(space()).result,'PASS');for(const extra of [{sameFilesystem:true},{dockerInPool:false},{workspaceInPool:false}])assert.equal(spaceDecision({...space(),...extra}).result,'BLOCKED');
});
test('resource budget stops low-root, low-space, inode exhaustion and oversized tmp usage',()=>{
 for(const change of [v=>v.root.freeBytes=127*MiB,v=>v.pool.freeBytes=9*1024*MiB,v=>v.pool.freeInodes=199999,v=>v.pool.usedBytes=13*1024*MiB]){const v=space();change(v);assert.equal(spaceDecision(v).result,'BLOCKED');}
});
test('guard reads actual tmp/root mounts and rejects a Docker root outside the temporary pool',async()=>{
 const a=await inspectSpace({directory:'/tmp/shadowbridge-r1-isolated',dockerRoot:'/tmp/shadowbridge-r1-isolated/overlay-data',workspace:'/tmp/shadowbridge-r1-isolated/baseline'});assert.equal(a.dockerInPool,true);assert.equal(a.workspaceInPool,true);assert.equal(a.root.device===a.pool.device,false);assert.equal(a.readOnly,true);
 const b=await inspectSpace({directory:'/tmp/shadowbridge-r1-isolated',dockerRoot:'/workspace'});assert.equal(b.result,'BLOCKED');assert.ok(b.reasons.some(v=>v.includes('Docker data-root')));
});
