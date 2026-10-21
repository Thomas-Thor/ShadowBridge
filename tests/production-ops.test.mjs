// Pure operator guards and synthetic HTTP responses; not backend integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDnsRecords, assertPreserved, publicComposeArguments, verifyPublic, isLegacyPublicGateway } from '../scripts/production-ops.mjs';

const release='b'.repeat(40);
const dns={ipv4:'203.0.113.42',addresses:['203.0.113.42'],localAddresses:['203.0.113.42']};
test('only the documented existing public Caddy may be stopped after backup',()=>{
  const labels={'com.docker.compose.service':'web','com.docker.compose.project.working_dir':'/opt/shadowbridge-public','com.docker.compose.project.config_files':'/opt/shadowbridge-public/compose.yaml,/opt/shadowbridge-public/override.yaml'};
  const current={Config:{Image:'caddy:2-alpine',Labels:labels}};
  assert.equal(isLegacyPublicGateway(current),true);
  assert.equal(isLegacyPublicGateway({Config:{...current.Config,Image:'nginx:latest'}}),false);
  for(const key of Object.keys(labels))assert.equal(isLegacyPublicGateway({Config:{...current.Config,Labels:{...labels,[key]:'unrelated'}}}),false);
  assert.equal(isLegacyPublicGateway({}),false);
});
test('DNS requires exactly the existing server IPv4, no stale AAAA or CNAME',()=>{
  assert.doesNotThrow(()=>assertDnsRecords(dns));
  for(const change of [{addresses:[]},{addresses:['203.0.113.43']},{addresses:['203.0.113.42','203.0.113.43']},{ipv6:['2001:db8::1']},{aliases:['old.github.io']},{localAddresses:['127.0.0.1']},{ipv4:'invalid'}])assert.throws(()=>assertDnsRecords({...dns,...change}));
});
test('restore equality protects every existing table and rejects lost rows',()=>{
  const before={'auth.users':'hash1','auth.mfa_factors':'hash2','sb.sessions':'hash3'};
  assert.doesNotThrow(()=>assertPreserved(before,{...before,'sb.new_table':'new'}));
  for(const name of Object.keys(before))assert.throws(()=>assertPreserved(before,{...before,[name]:'changed'}));
  assert.throws(()=>assertPreserved(before,{}));
});
test('additive migration catalog permits new keys while preserving all prior permissions',()=>{
  const before={'sb.staff_permissions':'catalog-old','permission:security.manage':'immutable','sb.accounts':'accounts'};
  const after={...before,'sb.staff_permissions':'catalog-new','permission:sentinel.read':'new'};
  assert.throws(()=>assertPreserved(before,after));
  assert.doesNotThrow(()=>assertPreserved(before,after,{allowMigrationBackfill:true}));
  assert.throws(()=>assertPreserved(before,{...after,'permission:security.manage':'changed'},{allowMigrationBackfill:true}));
  assert.throws(()=>assertPreserved(before,{...after,'sb.accounts':'changed'},{allowMigrationBackfill:true}));
});
test('production Compose keeps one explicit existing project and reviewed profile',()=>{
  const profile={project:'shadowbridge-contabo-existing',directory:'/workspace/ShadowBridge-private-b2b/.local/existing/production'};
  const args=publicComposeArguments(profile,['config','--quiet']);
  assert.equal(args[0],'compose');assert.ok(args.includes(profile.project));
  assert.ok(args.some(value=>value.endsWith('/deploy/production/compose.yaml')));
  assert.throws(()=>publicComposeArguments({...profile,project:'main; echo unsafe'},[]));
});

function syntheticHttp({wrongRelease=false,oldStatic=false,basicAuth=false,exposedSource=false,openPanel=false}={}) {
  return async input=>{
    const url=new URL(input);assert.equal(url.origin,'https://shadow-bridge.eu');
    const headers={'X-ShadowBridge-Release':wrongRelease?'c'.repeat(40):release};
    const json=value=>new Response(JSON.stringify(value),{status:200,headers:{...headers,'Content-Type':'application/json'}});
    if(basicAuth)return new Response('',{status:401,headers});
    if(oldStatic)return new Response('<html>Old GitHub Pages</html>',{status:200,headers});
    if(url.pathname==='/health')return json({ok:true});
    if(url.pathname==='/api/config')return json({backendEnabled:true,releaseSha:release});
    if(url.pathname.startsWith('/portal/'))return new Response('',{status:openPanel?200:303,headers:{...headers,Location:'/member-sign-in/'}});
    if(['/.env','/.git/config','/server/app.mjs','/auth/v1/settings','/prototypes/'].includes(url.pathname))return new Response('',{status:exposedSource?200:404,headers});
    return new Response('<html>Public page</html>',{status:200,headers});
  };
}
test('release verification checks backend, pages, protected panels and source denials',async()=>{
  const result=await verifyPublic(release,{request:syntheticHttp()});
  assert.equal(result.publicSmokeVerified,true);assert.equal(result.credentialsTested,false);
});
test('release verification refuses wrong release, old static site, Basic Auth and data exposure',async()=>{
  for(const fixture of [{wrongRelease:true},{oldStatic:true},{basicAuth:true},{exposedSource:true},{openPanel:true}])await assert.rejects(verifyPublic(release,{request:syntheticHttp(fixture)}));
});
