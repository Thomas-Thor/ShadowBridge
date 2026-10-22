// Real Caddy + Docker Compose + verified local TLS; protocol upstreams are
// explicitly FICTIONAL Node fixtures, not the real Contabo n8n or database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { prepareStaging, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { prepareProduction } from '../scripts/production-config.mjs';
import { productionBase, caddyImage, prepareGatewayProfile, n8nContainer } from '../scripts/n8n-gateway-profile.mjs';
import { publicComposeArguments } from '../scripts/production-ops.mjs';
import { assertGatewayOnly, gatewayUp } from '../scripts/n8n-gateway.mjs';

const id=randomBytes(5).toString('hex'),project='shadowbridge-stageg-n8n-wire-'+id;
const directory=path.join(repositoryRoot,'.local','n8n-wire-test-'+id);
const fixture=path.join(directory,'wire');const baseFile=path.join(fixture,'base.json'),overlayFile=path.join(fixture,'overlay.json');
const edge='shadowbridge-n8n-wire-edge-'+id;
const docker=(args,options={})=>execFileSync('docker',['--context','default',...args],{cwd:repositoryRoot,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:8*1024*1024,...options}).trim();
const compose=(args,overlay=false)=>docker(['compose','-p',project,'-f',baseFile,...(overlay?['-f',overlayFile]:[]),...args]);
const namesBefore=docker(['ps','--format','{{.ID}}']).split('\n').filter(Boolean).sort();
const report={kind:'n8n-gateway-local-wire',realCaddy:true,realDockerCompose:true,realVerifiedLocalTLS:true,upstream:'fictional-node-protocol-fixtures',realN8nTested:false,contaboChanged:false,publicAcmeTested:false,cases:[]};
let started=false,edgeCreated=false,current='fixture preparation',ca,httpsPort,httpPort;
const phase=async(name,fn)=>{current=name;await fn();report.cases.push({name,result:'PASS'});console.log('PASS: '+name);};
function request(host,path='/',{headers={},upgrade=false,plain=false}={}){return new Promise((resolve,reject)=>{
 const client=plain?http:https;const req=client.request({hostname:'127.0.0.1',port:plain?httpPort:httpsPort,servername:host,ca,rejectUnauthorized:true,path,headers:{Host:host,...headers},timeout:2500},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});
 if(upgrade)req.on('upgrade',(res,socket)=>{socket.destroy();resolve({status:res.statusCode,headers:res.headers});});
 req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Local TLS timeout')));req.end();
});}
async function ready(host){for(let i=0;i<60;i++){try{if((await request(host,'/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('Fixture readiness failed');}
const container=name=>compose(['ps','-q',name]);
try{
 await prepareStaging({directory,project});const profile=await prepareProduction({directory,releaseSha:productionBase});const candidate=await prepareGatewayProfile(profile);
 await phase('real production Compose merge is gateway-only, with external internal-edge reference',async()=>{
  const env={...process.env,...profile.composeEnvironment};
  const base=JSON.parse(docker(publicComposeArguments(profile,['config','--format','json']),{env}));
  const merged=JSON.parse(docker(publicComposeArguments({...profile,gatewayOverride:candidate.override},['config','--format','json']),{env}));
  assertGatewayOnly(base,merged,candidate.directory);
  assert.equal(Object.values(merged.services).filter(s=>s.ports?.length).length,1);
  assert.equal(merged.networks.automation_edge.external,true);
 });
 current='isolated Caddy wire fixture startup';await mkdir(fixture,{mode:0o700});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-sha256','-subj','/CN=shadowbridge-test.invalid','-addext','subjectAltName=DNS:shadow-bridge.eu,DNS:automation.shadow-bridge.eu,DNS:auth-proxy','-keyout',path.join(fixture,'public.key'),'-out',path.join(fixture,'public.crt')],{stdio:['ignore','pipe','pipe']});
 ca=await readFile(path.join(fixture,'public.crt'));
 const original=await readFile(path.join(profile.directory,'Caddyfile'),'utf8'),extended=await readFile(path.join(candidate.directory,'Caddyfile'),'utf8');
 const localTls=c=>c.replace('https://shadow-bridge.eu {','https://shadow-bridge.eu {\n tls /fixture/public.crt /fixture/public.key').replace('https://automation.shadow-bridge.eu {','https://automation.shadow-bridge.eu {\n tls /fixture/public.crt /fixture/public.key');
 await writeFile(path.join(fixture,'base.Caddyfile'),localTls(original),{mode:0o600,flag:'wx'});
 await writeFile(path.join(fixture,'automation.Caddyfile'),localTls(extended),{mode:0o600,flag:'wx'});
 const script=`const http=require('node:http'),crypto=require('node:crypto');for(const port of [8088,9999,5678]){const server=http.createServer((q,r)=>{if(q.url==='/signin'){r.setHeader('Content-Type','text/html');r.end('<html>FICTIONAL n8n sign in</html>');return;}r.setHeader('Content-Type','application/json');r.setHeader('X-ShadowBridge-Release',${JSON.stringify(productionBase)});if(q.url==='/headers'){r.setHeader('Set-Cookie','fictional=1; HttpOnly; Secure; SameSite=Lax');r.end(JSON.stringify(q.headers));return;}r.end(JSON.stringify(port===5678?{status:'ok'}:{ok:true}));});server.on('upgrade',(q,s)=>{const key=crypto.createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');s.end('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+key+'\\r\\n\\r\\n');});server.listen(port,'0.0.0.0');}`;
 await writeFile(path.join(fixture,'upstream.cjs'),script,{mode:0o600,flag:'wx'});
 docker(['network','create','--internal','--subnet',`10.244.${parseInt(id.slice(0,2),16)}.0/24`,'--label','shadowbridge.test=n8n-gateway',edge]);edgeCreated=true;
 const config={services:{upstream:{image:'node:24-alpine',command:['node','/fixture/upstream.cjs'],volumes:[`${fixture}:/fixture:ro`],networks:{private:{aliases:['app','auth']},edge:{aliases:[n8nContainer]}}},gateway:{image:caddyImage,entrypoint:['/bin/sh','/production/caddy-entrypoint.sh'],ports:['127.0.0.1::80','127.0.0.1::443'],read_only:true,tmpfs:['/tmp'],volumes:[`${path.join(repositoryRoot,'deploy/production/caddy-entrypoint.sh')}:/production/caddy-entrypoint.sh:ro`,`${path.join(fixture,'base.Caddyfile')}:/etc/caddy/Caddyfile:ro`,`${fixture}:/fixture:ro`,`${path.join(profile.directory,'proxy-token')}:/run/secrets/proxy-token:ro`,`${path.join(fixture,'public.crt')}:/run/secrets/auth-proxy.crt:ro`,`${path.join(fixture,'public.key')}:/run/secrets/auth-proxy.key:ro`,'caddy-data:/data','caddy-config:/config'],networks:{private:{aliases:['auth-proxy']},public:{}}}},networks:{private:{internal:true,ipam:{config:[{subnet:`10.246.${parseInt(id.slice(0,2),16)}.0/24`}]}},public:{ipam:{config:[{subnet:`10.245.${parseInt(id.slice(0,2),16)}.0/24`}]}},edge:{external:true,name:edge}},volumes:{'caddy-data':{},'caddy-config':{}}};
 // Match the real production x-private-proxy anchor; cloud Docker clients may
 // otherwise inject a corporate HTTP proxy into the Caddy test container.
 config.services.gateway.environment={HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:'',NO_PROXY:'localhost,127.0.0.1,app,auth,'+n8nContainer,no_proxy:'localhost,127.0.0.1,app,auth,'+n8nContainer};
 await writeFile(baseFile,JSON.stringify(config)+'\n',{mode:0o600,flag:'wx'});
 await writeFile(overlayFile,JSON.stringify({services:{gateway:{networks:{edge:{}},volumes:[`${path.join(fixture,'automation.Caddyfile')}:/etc/caddy/Caddyfile:ro`]}}})+'\n',{mode:0o600,flag:'wx'});
 started=true;compose(['up','-d','--pull','never']);
 const ports=()=>{httpPort=Number(compose(['port','gateway','80']).split(':').at(-1));httpsPort=Number(compose(['port','gateway','443']).split(':').at(-1));};ports();await ready('shadow-bridge.eu');
 const before=JSON.parse(docker(['inspect',container('gateway')]))[0],upstreamId=container('upstream');
 const volumeIds=before.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name).sort();
 docker(['network','connect',edge,before.Id]);
 await phase('existing main route works before change; production extension validates with actual Caddy',async()=>{
  assert.equal((await request('shadow-bridge.eu','/health')).status,200);
  assert.ok(!(await request('automation.shadow-bridge.eu','/healthz')).body.includes('"status":"ok"'));
  docker(['exec','-i',before.Id,'/bin/sh','-c','SB_PROXY_TOKEN="$(cat /run/secrets/proxy-token)"; export SB_PROXY_TOKEN; exec caddy validate --config - --adapter caddyfile'],{input:extended});
 });
 await phase('gateway-only recreation enables HTTPS, redirects, proxy headers and normal sign-in path',async()=>{
  compose(gatewayUp,true);ports();await ready('automation.shadow-bridge.eu');
  const main=await request('shadow-bridge.eu','/health');assert.equal(main.status,200);assert.equal(main.headers['x-shadowbridge-release'],productionBase);
  const health=await request('automation.shadow-bridge.eu','/healthz');assert.equal(health.status,200);assert.equal(JSON.parse(health.body).status,'ok');assert.equal(health.headers['x-robots-tag'],'noindex, nofollow, noarchive');
  const signIn=await request('automation.shadow-bridge.eu','/signin');assert.equal(signIn.status,200);assert.equal(signIn.headers['www-authenticate'],undefined);
  const redirect=await request('automation.shadow-bridge.eu','/signin?review=1',{plain:true});assert.equal(redirect.status,308);assert.equal(redirect.headers.location,'https://automation.shadow-bridge.eu/signin?review=1');
  const headers=await request('automation.shadow-bridge.eu','/headers',{headers:{'X-Forwarded-For':'203.0.113.99','X-Forwarded-Proto':'http',Forwarded:'for=203.0.113.99',Cookie:'FICTIONAL_SESSION=1',Authorization:'Bearer FICTIONAL_ONLY','X-ShadowBridge-Proxy-Token':'SPOOF','X-ShadowBridge-Client-IP':'SPOOF'}});
  const seen=JSON.parse(headers.body);assert.equal(seen['x-forwarded-proto'],'https');assert.equal(seen['x-forwarded-host'],'automation.shadow-bridge.eu');assert.ok(!seen['x-forwarded-for'].includes('203.0.113.99'));assert.equal(seen.forwarded,undefined);assert.equal(seen['x-shadowbridge-proxy-token'],undefined);assert.equal(seen['x-shadowbridge-client-ip'],undefined);assert.equal(seen.cookie,'FICTIONAL_SESSION=1');assert.equal(seen.authorization,'Bearer FICTIONAL_ONLY');assert.match(headers.headers['set-cookie'][0],/Secure/);
 });
 await phase('WebSocket upgrade traverses actual Caddy over verified TLS',async()=>{
  const r=await request('automation.shadow-bridge.eu','/rest/push',{upgrade:true,headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':randomBytes(16).toString('base64'),'Sec-WebSocket-Version':'13'}});assert.equal(r.status,101);
 });
 await phase('restart preserves edge attachment and Caddy volumes; n8n protocol service is not recreated',async()=>{
  const active=JSON.parse(docker(['inspect',container('gateway')]))[0];assert.ok(active.NetworkSettings.Networks[edge]);assert.deepEqual(active.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name).sort(),volumeIds);assert.equal(container('upstream'),upstreamId);
  assert.equal(Object.values(active.HostConfig.PortBindings).flat().every(v=>v.HostIp==='127.0.0.1'),true);
  assert.equal(JSON.parse(docker(['network','inspect',edge]))[0].Internal,true);
  compose(['restart','gateway'],true);ports();await ready('automation.shadow-bridge.eu');assert.equal((await request('automation.shadow-bridge.eu','/healthz')).status,200);
 });
 await phase('rollback restores main route and prior manual network attachment without changing volumes/upstream',async()=>{
  compose(gatewayUp);ports();await ready('shadow-bridge.eu');let restored=JSON.parse(docker(['inspect',container('gateway')]))[0];if(!restored.NetworkSettings.Networks[edge])docker(['network','connect',edge,restored.Id]);
  assert.ok(!(await request('automation.shadow-bridge.eu','/healthz')).body.includes('"status":"ok"'));assert.equal((await request('shadow-bridge.eu','/health')).status,200);assert.equal(container('upstream'),upstreamId);assert.deepEqual(restored.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name).sort(),volumeIds);
 });
 report.result='PASS';
}catch(error){report.result='FAIL';report.failedCase=current;report.errorType=error.name;await writeFile(path.join(directory,'failure.json'),JSON.stringify({message:error.message,stack:error.stack})+'\n',{mode:0o600});console.error('FAIL: '+current+'; private diagnostics retained.');process.exitCode=1;}
finally{
 if(started)compose(['stop']);report.fixtureStopped=started;report.isolatedEdgeRetained=edgeCreated;
 assert.deepEqual(docker(['ps','--format','{{.ID}}']).split('\n').filter(Boolean).sort(),namesBefore);
 report.originalRunningContainersPreserved=true;report.finishedAt=new Date().toISOString();
 await writeFile('/tmp/shadowbridge-n8n-gateway-results.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
