// Actual Caddy/TLS regression using retained FICTIONAL protocol containers.
// No container is recreated/removed. No connection to production n8n is made.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync,spawn } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const source=process.argv.find(a=>a.startsWith('--fixture='))?.slice(10);assert.ok(source,'Explicit retained fictional wire fixture required');
const fixture=path.resolve(source),parent=path.dirname(fixture);
assert.match(fixture,/\/.local\/n8n-wire-test-[a-f0-9]{10}\/wire$/);
const marker=JSON.parse(await readFile(path.join(parent,'manifest.json'),'utf8'));
assert.equal(marker.kind,'shadowbridge-private-contabo-v1');assert.match(marker.project,/^shadowbridge-stageg-n8n-wire-[a-f0-9]{10}$/);
const names={gateway:marker.project+'-gateway-1',upstream:marker.project+'-upstream-1'};
const docker=(args,input)=>execFileSync('docker',['--context','default',...args],{encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024,timeout:30000}).trim();
const original=docker(['ps','--format','{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort();
const identities={};for(const [key,name] of Object.entries(names)){const c=JSON.parse(docker(['inspect',name]))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],marker.project);assert.equal(c.State.Running,false);identities[key]=c.Id;}
assert.match(await readFile(path.join(fixture,'upstream.cjs'),'utf8'),/FICTIONAL n8n sign in/);
const id=randomBytes(5).toString('hex'),file='r1-'+id+'.Caddyfile',pidfile='/tmp/r1-'+id+'.pid';
let processHandle,result={kind:'r1-real-caddy-tls-retained-fixture',cases:[],realN8n:false,realApplicationUpstream:false,contaboChanged:false,containersRecreated:false};
try{
 docker(['start',names.upstream,names.gateway]);
 const gateway=JSON.parse(docker(['inspect',names.gateway]))[0],upstream=JSON.parse(docker(['inspect',names.upstream]))[0];
 const privateNetwork=Object.keys(gateway.NetworkSettings.Networks).find(n=>n.endsWith('_private'));assert.ok(privateNetwork);
 const ip=gateway.NetworkSettings.Networks[privateNetwork].IPAddress;
 assert.ok(Object.keys(gateway.NetworkSettings.Networks).some(n=>n.startsWith('shadowbridge-n8n-wire-edge-')));
 const base=await readFile(path.join(root,'deploy/production/Caddyfile.in'),'utf8'),append=await readFile(path.join(root,'deploy/automation/Caddyfile.append'),'utf8');
 let config=(base+append).replace('{\n','{\n auto_https off\n');
 for(const host of ['shadow-bridge.eu','automation.shadow-bridge.eu'])config=config.replace('https://'+host+' {','https://'+host+':9443 {\n tls /fixture/public.crt /fixture/public.key');
 config=config.replace('https://auth-proxy:8444 {','https://auth-proxy:9444 {');
 await writeFile(path.join(fixture,file),config,{mode:0o600,flag:'wx'});
 const command=`SB_PROXY_TOKEN="$(cat /run/secrets/proxy-token)"; export SB_PROXY_TOKEN; echo $$ > ${pidfile}; exec caddy run --config /fixture/${file} --adapter caddyfile`;
 processHandle=spawn('docker',['--context','default','exec',names.gateway,'/bin/sh','-c',command],{stdio:['ignore','ignore','ignore']});
 const probe=(host,pathname='/health',extraHeaders={},upgrade=false)=>JSON.parse(docker(['exec','-i',names.upstream,'node'],`const https=require('node:https'),fs=require('node:fs');const req=https.request({hostname:${JSON.stringify(ip)},port:9443,servername:${JSON.stringify(host)},ca:fs.readFileSync('/fixture/public.crt'),path:${JSON.stringify(pathname)},headers:{Host:${JSON.stringify(host+':9443')},...${JSON.stringify(extraHeaders)}},timeout:3000},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>console.log(JSON.stringify({status:res.statusCode,headers:res.headers,body})));});${upgrade?`req.on('upgrade',(res,s)=>{s.destroy();console.log(JSON.stringify({status:res.statusCode}));});`:''}req.on('timeout',()=>req.destroy());req.on('error',()=>process.exit(1));req.end();`));
 for(let n=0;;n++){try{if(probe('shadow-bridge.eu').status===200)break;}catch{}assert(n<30,'Caddy TLS readiness failed');await new Promise(r=>setTimeout(r,150));}
 assert.equal(probe('shadow-bridge.eu').headers['x-shadowbridge-release'],'7f794a298713d820af033ba2174cd60bfaa81e4b');
 result.cases.push({name:'actual merged Caddy serves main route with verified local TLS',result:'PASS'});
 const health=probe('automation.shadow-bridge.eu','/healthz');assert.equal(health.status,200);assert.equal(JSON.parse(health.body).status,'ok');assert.equal(health.headers['x-robots-tag'],'noindex, nofollow, noarchive');
 const signin=probe('automation.shadow-bridge.eu','/signin');assert.equal(signin.status,200);assert.equal(signin.headers['www-authenticate'],undefined);
 result.cases.push({name:'automation route and normal sign-in have HTTPS/noindex and no Basic Auth',result:'PASS'});
 const headers=JSON.parse(probe('automation.shadow-bridge.eu','/headers',{'X-Forwarded-For':'203.0.113.99','Forwarded':'for=203.0.113.99','X-ShadowBridge-Proxy-Token':'FICTIONAL-SPOOF'}).body);
 assert.equal(headers['x-forwarded-proto'],'https');assert.equal(headers['x-shadowbridge-proxy-token'],undefined);assert.equal(headers.forwarded,undefined);assert.ok(!headers['x-forwarded-for'].includes('203.0.113.99'));
 assert.equal(probe('automation.shadow-bridge.eu','/rest/push',{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':randomBytes(16).toString('base64'),'Sec-WebSocket-Version':'13'},true).status,101);
 result.cases.push({name:'proxy identity protection and WebSocket upgrade traverse real TLS Caddy',result:'PASS'});
 assert.equal(JSON.parse(docker(['inspect',names.upstream]))[0].Id,identities.upstream);assert.equal(JSON.parse(docker(['inspect',names.gateway]))[0].Id,identities.gateway);
 assert.equal(Object.values(gateway.HostConfig.PortBindings).flat().every(p=>p.HostIp==='127.0.0.1'),true);assert.equal(Object.keys(upstream.HostConfig.PortBindings||{}).length,0);
 result.cases.push({name:'loopback-only ports and retained container identities',result:'PASS'});result.result='PASS';
 for(const c of result.cases)console.log('PASS: '+c.name);
}catch(error){result.result='FAIL';result.errorType=error.name;await writeFile(path.join(fixture,'r1-'+id+'-failure.json'),JSON.stringify({message:error.message,stack:error.stack})+'\n',{mode:0o600});console.error('FAIL: R1 Caddy/TLS; private diagnostics retained');process.exitCode=1;}
finally{
 try{docker(['exec',names.gateway,'/bin/sh','-c',`if [ -f ${pidfile} ]; then kill "$(cat ${pidfile})"; fi`]);}catch{}
 if(processHandle)await new Promise(r=>{if(processHandle.exitCode!==null)r();else processHandle.once('exit',r);});
 docker(['stop',names.gateway,names.upstream]);
 assert.deepEqual(docker(['ps','--format','{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort(),original);result.originalRunningContainersPreserved=true;
 await writeFile('/tmp/shadowbridge-r1-gateway-results.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
}
