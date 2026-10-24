import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const code=await readFile(new URL('../assets/owner-book.js',import.meta.url),'utf8'),window={};vm.runInNewContext(code,{window,Blob,URL,setTimeout,clearTimeout});
const {keyExpiry,startSummaryDownload}=window.ShadowOwnerBook,now=Date.parse('2026-10-24T12:00:00Z');
test('all requested durations are exact; custom expiry is bounded, valid and never extends an existing key',()=>{
 for(const day of ['1','3','7','30','60'])assert.equal(Date.parse(keyExpiry(day,undefined,now)),now+Number(day)*86400000);
 const future=new Date(now+3600000),custom=new Date(future-future.getTimezoneOffset()*60000).toISOString().slice(0,16);assert.equal(Date.parse(keyExpiry('custom',custom,now)),future.getTime());
 for(const p of ['0','89','91','NaN',''])assert.throws(()=>keyExpiry(p,null,now));
 for(const v of ['','2026-02-30T12:00','2026-10-23T12:00','2027-03-01T12:00'])assert.throws(()=>keyExpiry('custom',v,now));
});
function browserFixture({clickThrows=false}={}){
 const state={created:0,revoked:0,attached:false,timer:null,blob:null,remember:null};
 const a={click(){assert.equal(state.attached,true);if(clickThrows)throw Error('FICTIONAL blocked download');},remove(){state.attached=false;}};
 return{state,a,options:{doc:{body:{append(node){assert.equal(node,a);state.attached=true;}},createElement(tag){assert.equal(tag,'a');return a;}},urlApi:{createObjectURL(blob){state.created++;state.blob=blob;return'blob:fictional-private-summary';},revokeObjectURL(url){assert.equal(url,'blob:fictional-private-summary');state.revoked++;}},schedule(fn,ms){assert.equal(ms,60000);state.timer=fn;},remember(fn){state.remember=fn;}}};
}
test('TXT uses an attached hidden anchor, exact UTF-8 plain text and delayed URL cleanup for Gecko/Chromium',async()=>{
 const f=browserFixture(),summary='FICTIONAL — Ø Ł ó\nNo HTML execution: <script>reference</script>';
 startSummaryDownload(summary,f.options);assert.equal(f.a.download,'ShadowBridge-owner-summary.txt');assert.equal(f.a.hidden,true);assert.equal(f.state.blob.type,'text/plain;charset=utf-8');assert.equal(await f.state.blob.text(),summary);assert.equal(f.state.revoked,0);assert.equal(f.state.attached,true);f.state.timer();assert.equal(f.state.revoked,1);assert.equal(f.state.attached,false);f.state.remember();assert.equal(f.state.revoked,1);
});
test('download errors expose no content, release Blob and anchor, and suggest the existing copy fallback',()=>{
 const f=browserFixture({clickThrows:true});assert.throws(()=>startSummaryDownload('FICTIONAL private summary',f.options),e=>/Copy reviewed summary/.test(e.message)&&!e.message.includes('FICTIONAL'));assert.equal(f.state.revoked,1);assert.equal(f.state.attached,false);
 for(const data of ['',null,'x'.repeat(1024*1024+1)])assert.throws(()=>startSummaryDownload(data,f.options));
});
test('session cleanup revokes private download data before the normal timer',()=>{const f=browserFixture();startSummaryDownload('FICTIONAL',f.options);f.state.remember();assert.equal(f.state.revoked,1);f.state.timer();assert.equal(f.state.revoked,1);});
