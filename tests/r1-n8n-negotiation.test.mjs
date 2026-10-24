import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {probe,probeSpecification,safeHttpEvidence,baseline} from '../scripts/international-r1-diagnose.mjs';
import https from 'node:https';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {prepareStaging} from '../scripts/staging-prepare.mjs';

test('real n8n negotiation scenario: HTML sign-in is 200 while JSON sign-in is 404',async()=>{
 const seen=[];
 const get=(options,callback)=>{
  seen.push(options);const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>req.emit('error',Error('timeout'));
  queueMicrotask(()=>{
   const res=new EventEmitter(),html=options.headers.Accept==='text/html';
   res.statusCode=options.path==='/signin'&&!html?404:200;
   res.headers={'content-type':options.path==='/signin'&&html?'text/html; charset=utf-8':'application/json'};
   res.socket={authorized:true,getPeerCertificate:()=>({fingerprint256:'FICTIONAL',valid_to:'FICTIONAL'})};
   callback(res);res.emit('data',Buffer.from(options.path==='/signin'?'<html>FICTIONAL n8n</html>':'{"status":"ok"}'));res.emit('end');
  });return req;
 };
 const html=await probe('automation.shadow-bridge.eu','/signin','signin',{get});assert.equal(html.ok,true);assert.equal(html.accept,'text/html');assert.equal(html.endpoint,'/signin');
 const health=await probe('automation.shadow-bridge.eu','/healthz','automation',{get});assert.equal(health.ok,true);assert.equal(health.accept,'application/json');
 assert.ok(seen.every(o=>o.rejectUnauthorized===true&&o.servername==='automation.shadow-bridge.eu'&&o.port===443));
});
test('TLS, status, response type, endpoint and health payload are independent fail-closed checks',()=>{
 const good={status:200,authorized:true,headers:{'content-type':'text/html'},body:{}};
 assert.equal(safeHttpEvidence(good,'signin').ok,true);
 for(const data of [{...good,authorized:false},{...good,status:404},{...good,status:302},{...good,headers:{'content-type':'application/json'}},{...good,headers:{...good.headers,'www-authenticate':'Basic'}}])assert.equal(safeHttpEvidence(data,'signin').ok,false);
 assert.equal(safeHttpEvidence({...good,body:{status:'error'}},'automation').ok,false);
 assert.equal(safeHttpEvidence({...good,body:{ok:true},headers:{'x-shadowbridge-release':baseline}},'main').ok,true);
 assert.throws(()=>probeSpecification('automation.shadow-bridge.eu','/signin','automation'),/ENDPOINT/);
 assert.throws(()=>probeSpecification('unrelated.invalid','/signin','signin'),/ENDPOINT/);
});
test('transport errors cannot become successful HTTP/TLS evidence',async()=>{
 const get=()=>{const req=new EventEmitter();req.setTimeout=()=>req;queueMicrotask(()=>req.emit('error',Error('FICTIONAL certificate error')));return req;};
 const r=await probe('automation.shadow-bridge.eu','/signin','signin',{get});assert.equal(r.ok,false);assert.equal(r.tlsVerified,false);assert.equal(r.error,'HTTPS_UNVERIFIED');
});
test('actual localhost HTTPS verifies a trusted certificate and content negotiation; an untrusted CA is refused',async()=>{
 const id=randomBytes(5).toString('hex'),dir=new URL('../.local/r1-probe-tls-'+id+'/',import.meta.url);
 await mkdir(dir,{recursive:true,mode:0o700});let server;
 try{
  const profile=new URL('profile/',dir);await prepareStaging({directory:profile.pathname,project:'shadowbridge-stageg-probe-'+id});
  const ca=await readFile(new URL('certs/internal-ca.crt',profile)),key=await readFile(new URL('certs/public.key',profile)),cert=await readFile(new URL('certs/public.crt',profile));
  server=https.createServer({key,cert},(req,res)=>{if(req.url==='/signin'){const html=req.headers.accept==='text/html';res.writeHead(html?200:404,{'Content-Type':html?'text/html':'application/json'});res.end(html?'<html>FICTIONAL local n8n sign in</html>':'{}');}else{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const get=(opts,cb)=>https.get({...opts,hostname:'127.0.0.1',port,servername:'localhost',ca},cb);
  assert.equal((await probe('automation.shadow-bridge.eu','/signin','signin',{get})).ok,true);
  assert.equal((await probe('automation.shadow-bridge.eu','/healthz','automation',{get})).ok,true);
  const bad=(opts,cb)=>https.get({...opts,hostname:'127.0.0.1',port,servername:'localhost',ca:[]},cb);
  const denied=await probe('automation.shadow-bridge.eu','/signin','signin',{get:bad});assert.equal(denied.ok,false);assert.equal(denied.tlsVerified,false);
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
