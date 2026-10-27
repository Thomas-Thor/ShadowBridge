import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {parseCsv,prepareCsv,canonicalLinkedIn,companyDomain,safeCsvCell} from '../workspace-csv.mjs';
import {blocks,renderBlocks} from '../workspace-content.mjs';
import {seal,open} from '../workspace-crypto.mjs';
import {loadWorkspaceConfig} from '../workspace-config.mjs';
test('CSV preserves quoted multiline fields, UTF-8 BOM and semicolon columns',()=>{
 const v=prepareCsv('\ufeffFirma;Imię;Nazwisko;LinkedIn;Uwagi\r\nPróba Ltd;Łukasz;Żółć;https://linkedin.com/in/test-one/?trk=abc;"line one\nline ""two"""\r\n');
 assert.equal(v.total,1);assert.equal(v.records[0].fullName,'Łukasz Żółć');assert.equal(v.records[0].notes,'line one\nline "two"');assert.equal(v.records[0].linkedin,'https://www.linkedin.com/in/test-one');assert.deepEqual(v.issues,[]);
});
test('CSV rejects ragged rows, malformed quotes, duplicate headers, bad encoding and oversized input',()=>{
 for(const s of ['Name,Company\nA,B,C','Name,Company\n"A,B','Name,Company\nA"x,B','Name,name\nA,B','Name,Company\nA,\ufffd','Name,Company\n'+('x'.repeat(2_000_001))])assert.throws(()=>parseCsv(s));
});
test('CSV duplicate people and weak identities are separated from valid rows; unknown columns remain',()=>{
 const r=prepareCsv('Name,Company,LinkedIn,Unknown\nA Person,Test SA,https://linkedin.com/in/a,one\nA Person,Test SA,https://linkedin.com/in/a,two\nOther Person,Test SA,,three');
 assert.deepEqual(r.issues,[{row:3,codes:['DUPLICATE_IN_FILE']},{row:4,codes:['STRONG_IDENTITY_REQUIRED']}]);assert.deepEqual(r.unmapped,['Unknown']);assert.equal(r.records[0].extras.Unknown,'one');
});
test('CSV mapping rejects unknown, reused and fabricated columns',()=>{
 const s='Name,Company,ID\nAlice Doe,Example Ltd,one';
 assert.throws(()=>prepareCsv(s,{mapping:{fullName:'Name',company:'Company',evil:'ID'}}));
 assert.throws(()=>prepareCsv(s,{mapping:{fullName:'Name',company:'Name'}}));assert.throws(()=>prepareCsv(s,{mapping:{fullName:'Missing',company:'Company'}}));
});
test('company-only CSV and stable source IDs work without invented people or emails',()=>{
 const v=prepareCsv('Firma,Kraj,Domena\nExample Ltd,NO,example.test',{kind:'companies'});assert.equal(v.records[0].fullName,'');assert.equal(v.records[0].email,'');assert.equal(v.records[0].kind,'companies');assert.deepEqual(v.issues,[]);
});
test('canonical identities reject credentials, unrelated hosts and non-person profiles',()=>{
 assert.equal(canonicalLinkedIn('https://linkedin.com.evil.test/in/a'),null);assert.equal(canonicalLinkedIn('https://linkedin.com/company/a'),null);assert.equal(companyDomain('https://a:b@example.test'),null);assert.equal(companyDomain('127.0.0.1'),null);assert.equal(companyDomain('https://www.Example.test/path'),'example.test');
});
test('export protects spreadsheet formulas while import retains literal source content',()=>{
 assert.equal(safeCsvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');const v=prepareCsv('Name,Company,ID,Notes\nA Person,Example Ltd,one,=1+2');assert.equal(v.records[0].notes,'=1+2');
});
test('content renders text safely, keeps a bounded block vocabulary and refuses active URLs',()=>{
 const rendered=renderBlocks([{id:'block-one',type:'paragraph',text:'<img src=x onerror=alert(1)>'}]);assert.ok(rendered.includes('&lt;img'));assert.equal(rendered.includes('<img'),false);
 for(const href of ['javascript:alert(1)','https://evil.test','//evil.test','/\\evil.test','/ok?token=x','/../api'])assert.throws(()=>blocks([{id:'button-one',type:'button',text:'Open',href}]));
 assert.throws(()=>blocks([{id:'block-one',type:'paragraph',text:'x',html:'<b>x</b>'}]));assert.throws(()=>blocks([{id:'block-one',type:'script'}]));
});
test('content blocks reject duplicate IDs and malformed private media IDs',()=>{
 assert.throws(()=>blocks([{id:'block-one',type:'divider'},{id:'block-one',type:'divider'}]));assert.throws(()=>blocks([{id:'image-one',type:'image',fileId:'../../private',alt:'photo'}]));assert.ok(renderBlocks([{id:'image-one',type:'image',fileId:randomUUID(),alt:'<private>'}]).includes('&lt;private&gt;'));
});
test('private encryption binds ciphertext to its record and context and detects tampering',()=>{
 const key=randomBytes(32),a=seal({example:'FICTIONAL'},key,'import:one');assert.deepEqual(open(a,key,'import:one',{json:true}),{example:'FICTIONAL'});assert.throws(()=>open(a,key,'file:one'));assert.throws(()=>open(a,randomBytes(32),'import:one'));assert.throws(()=>open(a.slice(0,-2)+'00',key,'import:one'));assert.throws(()=>seal('x',null,'one'));
});
test('optional integrations fail closed and reject unsafe configuration',async()=>{
 const base={APP_ENV:'test'};assert.equal((await loadWorkspaceConfig(base)).enabled,false);await assert.rejects(loadWorkspaceConfig({...base,COMMAND_CENTER_R2_ENABLED:'true'}));await assert.rejects(loadWorkspaceConfig({...base,CRM_IMPORT_WRITES_ENABLED:'true'}));await assert.rejects(loadWorkspaceConfig({...base,PUBLIC_ANALYTICS_ENABLED:'true'}));await assert.rejects(loadWorkspaceConfig({...base,MEDIA_SERVICE_URL:'http://metadata.internal'}));await assert.rejects(loadWorkspaceConfig({...base,COMMAND_CENTER_R2_ENABLED:'yes'}));
});
