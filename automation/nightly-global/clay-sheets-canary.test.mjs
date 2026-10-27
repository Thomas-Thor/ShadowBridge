import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {claySheetsCanary as step} from './clay-sheets-canary.mjs';import {buildClayCanary} from './build-clay-canary.mjs';import {clayCsvPayload} from './clay-export-canary.mjs';
const headers=['ShadowBridge ID','Company','Country','Industry','Full Name','Title','Website','LinkedIn','Source','Email status','Email'];
const response=values=>({statusCode:200,body:{values}}),now='2026-10-26T22:00:00Z';
const fixture=()=>({company:'FICTIONAL Company',country:'Norway',industry:'Machinery',fullName:'FICTIONAL Person',title:'Export manager',website:'https://company.example.invalid',personLinkedIn:'https://www.linkedin.com/in/fictional-person'});
const request=(rows=[fixture()],mode='append')=>step('validate',{body:{mode,batchId:'fixture-batch-00001',rows},now});
test('CSV quotes/newlines/BOM and separators work; email, phone and unmapped private columns never reach the payload',()=>{
 const csv='\uFEFFCompany Name;Company Country;Industry;First Name;Last Name;Job Title;Website;LinkedIn URL;Email;Phone\r\n"FICTIONAL; Company";Norway;"Line one\nLine two";Fictional;Person;"Export ""manager""";company.example.invalid;https://linkedin.com/in/fictional-person;PRIVATE_EMAIL;PRIVATE_PHONE\r\n';
 const p=clayCsvPayload(csv,{kind:'person',batchId:'fixture-batch-00001'});assert.equal(p.rows.length,1);assert.equal(p.rows[0].fullName,'Fictional Person');assert.equal(p.rows[0].title,'Export "manager"');assert.ok(!JSON.stringify(p).includes('PRIVATE_'));assert.equal(p.mode,'preview');assert.equal(request(p.rows).rows[0].emailStatus,'not_collected');
 assert.throws(()=>clayCsvPayload('Name\n"unclosed',{kind:'company'}),/QUOTING/);assert.throws(()=>clayCsvPayload('Name\n'+Array(6).fill('fictional').join('\n'),{kind:'company'}),/MAXIMUM_FIVE/);
});
test('CSV kind never confuses a company name with a person and does not invent missing surnames',()=>{
 assert.equal(clayCsvPayload('Name,Country,Website\nFICTIONAL company,NO,company.example.invalid',{kind:'company'}).rows[0].fullName,'');
 assert.throws(()=>clayCsvPayload('Company Name,First Name\nFICTIONAL company,Fictional',{kind:'person'}),/FULL_NAME_REQUIRED/);
});
test('preview and verified append reject excess rows, unknown identity and claimed private email/phone fields are omitted',()=>{
 assert.throws(()=>request(Array(6).fill(fixture())),/MAXIMUM_FIVE/);assert.throws(()=>request([{company:'FICTIONAL',fullName:'Same Name'}]),/STABLE_IDENTITY/);
 const r=request([{...fixture(),email:'PRIVATE_UNSOLICITED',phone:'PRIVATE_PHONE'}]);assert.ok(!JSON.stringify(r).includes('PRIVATE_'));const plan=step('plan',{request:r,response:response([headers])});assert.equal(plan.newRows,1);assert.equal(plan.appendBody.values[0].at(-1),'');assert.equal(step('preview',{plan}).crmWrites,0);
});
test('existing verified emails and manual fields remain unchanged, duplicates produce no append or overwrite',()=>{
 const r=request(),p=step('plan',{request:r,response:response([headers])}),cells=p.appendBody.values[0];cells[9]='verified';cells[10]='PRIVATE_EXISTING_EMAIL';const before=JSON.stringify(cells);
 const again=step('plan',{request:r,response:response([headers,cells])});assert.equal(again.canWrite,false);assert.equal(again.duplicates,1);assert.equal(again.appendBody.values.length,0);assert.equal(JSON.stringify(cells),before);assert.equal(step('verify',{plan:again,response:response([headers,cells])}).confirmedUniqueRows,1);
});
test('identity conflicts, ambiguous headers and legacy rows without IDs stop instead of silently merging',()=>{
 const r=request(),p=step('plan',{request:r,response:response([headers])}),row=p.appendBody.values[0];row[1]='DIFFERENT company';assert.throws(()=>step('plan',{request:r,response:response([headers,row])}),/DATA_CONFLICT/);
 assert.throws(()=>step('plan',{request:r,response:response([headers.slice(1)])}),/MISSING_SB_KEY/);assert.throws(()=>step('plan',{request:r,response:response([[...headers,'SB Key']])}),/AMBIGUOUS_COLUMN/);
 assert.throws(()=>step('plan',{request:r,response:response([headers,['','LEGACY PRIVATE COMPANY']])}),/LEGACY_IDENTITY/);
 assert.throws(()=>step('plan',{request:request([fixture(),{...fixture(),fullName:'Different Person'}]),response:response([headers])}),/BATCH_IDENTITY_CONFLICT/);
});
test('sheet selection is explicit, bounded and quoted; no guessing Sheet1 or changing headers',()=>{
 const metadata={statusCode:200,body:{sheets:[{properties:{title:"Owner's CRM",sheetType:'GRID',gridProperties:{rowCount:1000,columnCount:26}}}]}};
 assert.equal(step('sheet',{response:metadata}).range,"'Owner''s CRM'!A1:CV20000");metadata.body.sheets.push(structuredClone(metadata.body.sheets[0]));assert.throws(()=>step('sheet',{response:metadata}),/TAB_SELECTION/);metadata.body.sheets.pop();metadata.body.sheets[0].properties.gridProperties.rowCount=100000;assert.throws(()=>step('sheet',{response:metadata}),/TOO_LARGE/);
});
test('inspection reads existing CRM without accepting input contacts, write plans or exposing stored records',()=>{
 const r=request([],'inspect');assert.equal(r.rows.length,0);assert.throws(()=>request([fixture()],'inspect'),/INSPECT_NO_RECORDS/);
 const privateRow=['id1','FICTIONAL PRIVATE COMPANY','NO','Machinery','FICTIONAL PRIVATE PERSON','','','','','VALID','private@example.invalid'];
 const p=step('plan',{request:r,response:response([headers,privateRow])});const out=step('preview',{plan:p});assert.equal(out.status,'CRM_READ_CONFIRMED');assert.equal(out.existingRows,1);assert.equal(out.canWrite,false);assert.equal(out.crmWrites,0);assert.equal(out.emailColumnPresent,true);assert.equal(out.emailWritingSupported,false);assert.ok(!p.appendBody);assert.ok(!JSON.stringify(out).includes('PRIVATE'));assert.ok(!JSON.stringify(out).includes('private@example.invalid'));
 const bad=step('plan',{request:r,response:response([['Company'],['FICTIONAL LEGACY']])});assert.equal(bad.canarySchemaReady,false);assert.equal(bad.legacyRows,1);assert.ok(bad.missingFields.includes('sbKey'));assert.equal(step('preview',{plan:bad}).status,'CRM_READ_CONFIRMED');
 const repeated=step('plan',{request:r,response:response([headers,privateRow,privateRow])});assert.equal(repeated.duplicateIds,1);assert.equal(repeated.canarySchemaReady,false);
});
test('readback failure or duplicates never claim success; verification-only mode cannot authorize append',()=>{
 const r=request(),p=step('plan',{request:r,response:response([headers])});assert.throws(()=>step('verify',{plan:p,response:response([headers])}),/NOT_CONFIRMED_NO_AUTOMATIC_RETRY/);assert.throws(()=>step('verify',{plan:p,response:response([headers,...p.appendBody.values,...p.appendBody.values])}),/DUPLICATE_ID_AFTER_WRITE/);
 assert.equal(step('plan',{request:request([fixture()],'verify'),response:response([headers])}).canWrite,false);assert.throws(()=>step('appendAck',{plan:p,response:{statusCode:403,body:{}}}),/ACK_NOT_CONFIRMED/);
});
test('generated workflow has one authenticated intake, fixed Sheets host, RAW append, no provider calls/schedule, and safe error responses',()=>{
 const w=buildClayCanary({spreadsheetId:'fictionalSpreadsheetIdentifier123456'});assert.equal(w.name,'ShadowBridge Global B2B Sourcing V1');assert.equal(w.active,false);assert.equal(w.nodes.filter(n=>n.type.endsWith('.webhook')).length,1);assert.equal(w.nodes[0].parameters.authentication,'headerAuth');assert.ok(!w.nodes.some(n=>/schedule|email|whatsapp/i.test(n.type)));
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest'))){assert.equal(n.parameters.nodeCredentialType,'googleSheetsOAuth2Api');assert.equal(n.retryOnFail,false);assert.ok(n.parameters.url.includes('sheets.googleapis.com'));assert.equal(w.connections[n.name].main[1][0].node,'Sanitize failure');}
 assert.ok(w.nodes.find(n=>n.name==='Append only missing rows').parameters.url.includes('valueInputOption=RAW'));assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveManualExecutions,false);
 const sanitize=w.nodes.find(n=>n.name==='Sanitize failure').parameters.jsCode;const result=Function('$input',sanitize)({first:()=>({json:{error:{message:'PRIVATE_TOKEN PRIVATE_CONTACT'}}})});assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
 for(const n of w.nodes.filter(n=>n.type.endsWith('.code')))assert.doesNotThrow(()=>Function('$input','$',n.parameters.jsCode));
});
test('local HTTP fixture actually appends only a missing row and proves readback; this is not native n8n or Google',async()=>{
 const values=[headers],events=[],server=createServer(async(req,res)=>{events.push(req.method);res.setHeader('Content-Type','application/json');if(req.method==='POST'){let text='';for await(const b of req)text+=b;const body=JSON.parse(text);values.push(...body.values);res.end(JSON.stringify({updates:{updatedRows:body.values.length}}));}else res.end(JSON.stringify({values}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url='http://127.0.0.1:'+server.address().port,read=async()=>{const r=await fetch(url);return{statusCode:r.status,body:await r.json()};},r=request(),p=step('plan',{request:r,response:await read()});const raw=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p.appendBody)});step('appendAck',{plan:p,response:{statusCode:raw.status,body:await raw.json()}});const done=step('verify',{plan:p,response:await read()});assert.equal(done.rowsAppended,1);assert.equal(done.dataCreditsUsedByBridge,0);assert.equal(done.emailAddressesCollected,0);const repeat=step('plan',{request:r,response:await read()});assert.equal(repeat.newRows,0);assert.equal(events.filter(v=>v==='POST').length,1);}finally{await new Promise(resolve=>server.close(resolve));}
});
