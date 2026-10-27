import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {centralCrmSync as sync} from './central-crm-sync-core.mjs';
import {buildCentralCrmSync} from './build-central-crm-sync.mjs';
import {decodeBackup, decodeSourceManifest, parseCsv, validateBackupSet} from './central-crm-backup-input.mjs';
import {legacyBody, migrateWorkflow, restoreWorkflow, synchronizeBatch, reportFailure} from './central-crm-sync-operator.mjs';
import {compareCanaryGraph} from './n8n-workflow-graph.mjs';

const headers = {
  KONTRAHENCI: ['ID_FIRMY','Firma','Typ','Kraj','Branza','Produkty','Strona WWW','Email','Telefon','Osoba kontaktowa','Status','Zrodlo','Agent','Data aktualizacji','Uwagi','Klucz firmy','Weryfikacja','Ostatni kontakt','Nastepna akcja','Data nastepnej akcji','Komisja status','Zgoda na kontakt'],
  KONTAKTY: ['ID_KONTAKTU','ID_FIRMY','Firma','Osoba','Stanowisko','Email','Telefon','LinkedIn','Jezyk','Kanal preferowany','Zrodlo','Status weryfikacji','Uwagi','Opiekun kontaktu'],
  AGENT_RUNS: ['RUN_ID','DATA_OSLO','AGENT','START_OSLO','KONIEC_OSLO','STATUS','NOWE_REKORDY','ZAKTUALIZOWANE_REKORDY','ID_REKORDOW_CRM','ARKUSZE_CRM','ZRODLA_URL','NARZEDZIA','BLAD_LUB_BRAKI','UWAGI'],
};
const now = '2026-10-27T12:00:00Z', batchId = 'fictional_batch_00001';
const person = {sourceId:'fictional_1',fullName:'Fikcyjna Osoba 日本',company:'Fictional Export Ltd',title:'Export Manager',domain:'fictional.example',website:'https://fictional.example',personLinkedIn:'https://pl.linkedin.com/in/fictional-one/',location:'Fictional location'};
function fixture() {
  const tables = Object.fromEntries(Object.entries(headers).map(([k,v])=>[k,[structuredClone(v)]]));
  const metadata = {sheets: Object.keys(tables).map((title,i)=>({properties:{title,sheetId:i+1,sheetType:'GRID',gridProperties:{rowCount:1000,columnCount:26}}}))};
  for(let i=0;i<9;i++)metadata.sheets.push({properties:{title:'Unrelated '+i,sheetId:i+10,gridProperties:{rowCount:1000,columnCount:26}}});
  const sheets = sync('sheets',{response:{statusCode:200,body:metadata}});
  const response = ()=>({statusCode:200,body:{valueRanges:Object.entries(tables).map(([title,values])=>({range:title+'!A1:Z1000',values:structuredClone(values)}))}});
  const request = (mode='append',rows=[person],id=batchId)=>sync('validate',{body:{mode,batchId:id,rows:structuredClone(rows),protocol:'CENTRAL_CRM_V2'},now});
  const plan = (req=request())=>sync('plan',{request:req,response:response(),sheets});
  const commit = p=>{
    for(const entry of p.writeBody.requests){const [title]=Object.entries(sheets).find(([,v])=>v.sheetId===entry.appendCells.sheetId);tables[title].push(...entry.appendCells.rows.map(r=>r.values.map(c=>c.userEnteredValue.stringValue)));}
    sync('ack',{plan:p,response:{statusCode:200,body:{replies:p.writeBody.requests.map(()=>({}))}}});
    return sync('verify',{plan:p,response:response(),sheets});
  };
  return {tables,metadata,sheets,response,request,plan,commit};
}
test('uses the three existing tabs in a 12-tab CRM and stays inside actual columns',()=>{
  const f=fixture();assert.deepEqual(Object.keys(f.sheets),['KONTRAHENCI','KONTAKTY','AGENT_RUNS']);
  assert.equal(f.sheets.KONTAKTY.range,"'KONTAKTY'!A:Z");
  f.metadata.sheets[0].properties.hidden=true;assert.throws(()=>sync('sheets',{response:{statusCode:200,body:f.metadata}}),/TARGET_TAB/);
});
test('new company, contact and audit are one atomic request and existing curated rows stay unchanged',()=>{
  const f=fixture(),before=structuredClone(f.tables),p=f.plan();
  assert.equal(p.newCompanies,1);assert.equal(p.newContacts,1);assert.equal(p.writeBody.requests.length,3);
  assert.ok(p.writeBody.requests.every(r=>r.appendCells && !r.updateCells));
  const receipt=f.commit(p);assert.equal(receipt.crmWrites,3);assert.equal(receipt.confirmedContacts,1);
  for(const title of Object.keys(before))assert.deepEqual(f.tables[title].slice(0,before[title].length),before[title]);
  const cells=f.tables.KONTAKTY[1];assert.equal(cells[5],'');assert.equal(cells[6],'');assert.equal(cells[7],'https://www.linkedin.com/in/fictional-one');
});
test('same committed batch is verified with zero new rows; a different batch also deduplicates',()=>{
  const f=fixture();f.commit(f.plan());
  const replay=f.plan();assert.equal(replay.canWrite,false);assert.equal(replay.duplicateContacts,1);assert.equal(replay.priorReceipt,true);
  assert.equal(sync('verify',{plan:replay,response:f.response(),sheets:f.sheets}).crmWrites,0);
  const next=f.plan(f.request('append',[person],'fictional_next_batch'));assert.equal(next.newContacts,0);assert.equal(next.canWrite,false);
});
test('two people from one company create one company and preserve a preexisting company ID',()=>{
  const f=fixture(),second={...person,sourceId:'fictional_2',fullName:'Second Person',personLinkedIn:'https://linkedin.com/in/fictional-two'};
  const p=f.plan(f.request('append',[person,second]));assert.equal(p.newCompanies,1);assert.equal(p.newContacts,2);f.commit(p);
  const third={...person,sourceId:'fictional_3',fullName:'Third Person',personLinkedIn:'https://linkedin.com/in/fictional-three'};
  const next=f.plan(f.request('append',[third],'fictional_third_batch'));assert.equal(next.newCompanies,0);assert.equal(next.newContacts,1);
  assert.equal(next.appendRows.KONTAKTY[0][1],f.tables.KONTRAHENCI[1][0]);
});
test('existing names and ambiguous domains cause review rather than duplicate creation or overwrites',()=>{
  const f=fixture();f.commit(f.plan());
  const other={...person,sourceId:'fictional_2',fullName:'Another Person',personLinkedIn:'https://linkedin.com/in/fictional-two',domain:'other.example',website:'https://other.example'};
  let p=f.plan(f.request('preview',[other],'review_company_batch'));assert.equal(p.reviewReasons.POSSIBLE_COMPANY_DUPLICATE,1);assert.equal(p.newContacts,0);
  const secondCompany=structuredClone(f.tables.KONTRAHENCI[1]);secondCompany[0]='existing_other_id';f.tables.KONTRAHENCI.push(secondCompany);
  p=f.plan(f.request('preview',[{...other,domain:person.domain,website:person.website}],'review_domain_batch'));assert.equal(p.reviewReasons.AMBIGUOUS_COMPANY_DOMAIN,1);
});
test('name and employer match without the same LinkedIn is a review item',()=>{
  const f=fixture();f.commit(f.plan());
  const p=f.plan(f.request('preview',[{...person,sourceId:'another_id',personLinkedIn:'https://linkedin.com/in/other-slug'}],'review_person_batch'));
  assert.equal(p.reviewReasons.POSSIBLE_PERSON_DUPLICATE,1);assert.equal(p.newContacts,0);
});
test('mixed accepted and review rows can be reconciled after an interrupted write',()=>{
  const f=fixture(),review={...person,sourceId:'review_id',fullName:'Needs Review',personLinkedIn:'https://linkedin.com/in/needs-review',domain:'',website:''};
  f.commit(f.plan(f.request('append',[person,review])));
  const verify=f.plan(f.request('verify',[person,review]));assert.equal(verify.reviewRequired,1);
  assert.equal(sync('verify',{plan:verify,response:f.response(),sheets:f.sheets}).status,'READBACK_CONFIRMED');
});
test('an existing duplicate profile is reported without changing it',()=>{
  const f=fixture();f.commit(f.plan());const row=structuredClone(f.tables.KONTAKTY[1]);row[0]='existing_duplicate';f.tables.KONTAKTY.push(row);
  const p=f.plan(f.request('inspect',[]));assert.equal(p.existingDuplicateProfiles,1);assert.equal(p.canWrite,false);
});
test('changed source identity, duplicate CRM IDs, wrong tab, missing headers and auth failure stop writes',()=>{
  const f=fixture();assert.throws(()=>f.request('append',[{...person,domain:'different.example'}]),/DOMAIN_CONFLICT/);
  assert.throws(()=>f.request('append',Array(6).fill(person)),/MAXIMUM_FIVE/);
  assert.throws(()=>f.request('append',[{...person,email:'private@example.test'}]),/EMAIL_PHONE/);
  assert.throws(()=>f.plan(f.request('append',[person,{...person,company:'Conflicting Company'}])),/BATCH_IDENTITY_CONFLICT/);
  f.commit(f.plan());f.tables.KONTAKTY.push(structuredClone(f.tables.KONTAKTY[1]));assert.throws(()=>f.plan(),/EXISTING_DUPLICATE_ID/);
  const g=fixture();g.tables.KONTAKTY[0][0]='Wrong ID';assert.throws(()=>g.plan(),/COLUMN_MISSING/);
  const h=fixture(),response=h.response();response.body.valueRanges[0].range='Unrelated!A1:Z1000';assert.throws(()=>sync('plan',{request:h.request(),response,sheets:h.sheets}),/RANGE_MISMATCH/);
  assert.throws(()=>sync('sheets',{response:{statusCode:403,body:{privateToken:'never returned'}}}),/READ_NOT_CONFIRMED/);
});
test('concurrent changes block the write and readback verifies every new field',()=>{
  const f=fixture(),p=f.plan();f.tables.KONTAKTY[0].push('Human added column');
  assert.throws(()=>sync('recheck',{plan:p,response:f.response(),sheets:f.sheets}),/CHANGED_BEFORE_WRITE/);
  const g=fixture(),q=g.plan();g.commit(q);g.tables.KONTAKTY[1][3]='Unexpected edit';
  assert.throws(()=>sync('verify',{plan:q,response:g.response(),sheets:g.sheets}),/FIELDS_DIFFER/);
});
test('untrusted spreadsheet strings are string cells and never formulas',()=>{
  const f=fixture(),p=f.plan(f.request('append',[{...person,fullName:'=IMPORTXML("https://fictional.example")'}]));
  const cell=p.writeBody.requests[1].appendCells.rows[0].values[3];assert.equal(typeof cell.userEnteredValue.stringValue,'string');assert.equal(cell.userEnteredValue.formulaValue,undefined);
});
test('workflow uses existing OAuth and webhook bindings, privacy settings and stage-specific failure reporting',()=>{
  const w=buildCentralCrmSync({spreadsheetId:'fictional_sheet',googleCredentialId:'fictional_google',ingestCredentialId:'fictional_ingress'});
  assert.equal(w.name,'ShadowBridge Global B2B Sourcing V1');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveDataSuccessExecution,'none');
  assert.equal(w.settings.saveManualExecutions,false);assert.ok(!w.nodes.some(n=>/schedule|sendEmail/i.test(n.type)));
  for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest'))){assert.equal(n.credentials.googleSheetsOAuth2Api.id,'fictional_google');assert.equal(n.retryOnFail,false);assert.ok(!JSON.stringify(n.parameters).includes('clay.com'));}
  const fail=w.nodes.find(n=>n.name==='Report crm.plan');
  const error=vm.runInNewContext(fail.parameters.jsCode.includes('return')?'(function(){'+fail.parameters.jsCode+'})()':'',{ $input:{first:()=>({json:{error:{message:'CRM_SYNC_COLUMN_MISSING_OR_AMBIGUOUS [line 3] secret=DO_NOT_OUTPUT'}}})}});
  assert.equal(error[0].json.stage,'crm.plan');assert.equal(error[0].json.reason,'CRM_SYNC_COLUMN_MISSING_OR_AMBIGUOUS');assert.ok(!JSON.stringify(error).includes('DO_NOT_OUTPUT'));
});
test('every generated Code node compiles as n8n JavaScript and every connection target exists',()=>{
  const w=buildCentralCrmSync({spreadsheetId:'fictional_sheet',googleCredentialId:'fictional_google',ingestCredentialId:'fictional_ingress'}),names=new Set(w.nodes.map(n=>n.name));
  for(const node of w.nodes.filter(n=>n.type.endsWith('.code')))new vm.Script('(function(){'+node.parameters.jsCode+'})');
  for(const ports of Object.values(w.connections))for(const branch of ports.main)for(const edge of branch||[])assert.ok(names.has(edge.node));
  const validate=w.nodes.find(n=>n.name==='Validate five backup profiles');
  const result=vm.runInNewContext('(function(){'+validate.parameters.jsCode+'})()',{ $input:{first:()=>({json:{body:{mode:'preview',batchId,rows:[person]}}})}});
  assert.equal(result[0].json.rows[0].fullName,person.fullName);
});
test('CSV parser supports quoted multiline international values, escaped quotes and rejects malformed input',()=>{
  assert.deepEqual(parseCsv('A,B\r\n"Łódź\n日本","a""b"\r\n'),[['A','B'],['Łódź\n日本','a"b']]);
  assert.throws(()=>parseCsv('"never closed'),/UNCLOSED_QUOTE/);assert.throws(()=>parseCsv('"x"trailing'),/CSV_INVALID/);
});
test('backup blobs are pinned and emails/count changes are rejected before deployment',()=>{
  const bytes=Buffer.from('ID,Name,Company,Job title,Domain,Website,LinkedIn,Location,Work email,Clay task\n1,Person,Company,Role,fictional.example,https://fictional.example,https://linkedin.com/in/fictional,Place,,task\n');
  const file={rows:1,blob:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
  assert.equal(decodeBackup(bytes,file).length,1);assert.throws(()=>decodeBackup(Buffer.concat([bytes,Buffer.from('\n')]),file),/HASH_MISMATCH/);
  assert.throws(()=>validateBackupSet([]),/INCOMPLETE/);
});
test('private local manifests require the pinned content, safe filenames and consistent totals',()=>{
  const manifest={version:1,commit:'1'.repeat(40),totalRows:2,files:[{name:'fictional_backup.csv',blob:'2'.repeat(40),rows:2}]};
  const encode=value=>{const bytes=Buffer.from(JSON.stringify(value)+'\n');return {bytes,blob:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};};
  let value=encode(manifest);assert.equal(decodeSourceManifest(value.bytes,value.blob).totalRows,2);
  assert.throws(()=>decodeSourceManifest(value.bytes,'3'.repeat(40)),/HASH_MISMATCH/);
  value=encode({...manifest,files:[{...manifest.files[0],name:'../outside.csv'}]});assert.throws(()=>decodeSourceManifest(value.bytes,value.blob),/FILE_INVALID/);
  value=encode({...manifest,totalRows:3});assert.throws(()=>decodeSourceManifest(value.bytes,value.blob),/COUNTS_INVALID/);
});
test('different non-Latin person names are not collapsed into a false duplicate',()=>{
  const f=fixture();f.commit(f.plan(f.request('append',[{...person,fullName:'张伟'}])));
  const p=f.plan(f.request('append',[{...person,sourceId:'other_asian_person',fullName:'王芳',personLinkedIn:'https://linkedin.com/in/fictional-second-name'}],'different_name_batch'));
  assert.equal(p.reviewRequired,0);assert.equal(p.newContacts,1);
});
function migrationFixture(){
  const old=legacyBody({spreadsheetId:'fictional_sheet_id_1234567890',googleId:'fictional_google',ingressId:'fictional_ingress'}).body;
  const desired=buildCentralCrmSync({spreadsheetId:'fictional_sheet_id_1234567890',googleCredentialId:'fictional_google',ingestCredentialId:'fictional_ingress'});
  let current={...structuredClone(old),active:true,id:'fictional_workflow'};const calls=[],state={};
  const api=async(method,suffix,body)=>{calls.push([method,suffix]);if(method==='PUT')current={...structuredClone(body),active:false,id:'fictional_workflow'};if(suffix==='/activate')current.active=true;if(suffix==='/deactivate')current.active=false;return structuredClone(current);};
  const options={api,expectedOld:old,desired,state,save:async()=>{},backup:async mode=>{calls.push(['BACKUP',mode]);return {hash:'fictional_backup_hash'};}};
  return {options,calls,getCurrent:()=>structuredClone(current)};
}
test('migration backs up before deactivation, replaces only the recognized graph and activates the same workflow',async()=>{
  const f=migrationFixture();const result=await migrateWorkflow({...f.options,current:f.getCurrent()});
  assert.equal(result.active,true);assert.ok(compareCanaryGraph(f.options.desired,result).graphMatches);
  assert.ok(f.calls.findIndex(c=>c[0]==='BACKUP')<f.calls.findIndex(c=>c[1]==='/deactivate'));
  assert.equal(f.calls.filter(c=>c[0]==='PUT').length,1);
});
test('migration refuses an edited workflow and never retries an uncertain PUT',async()=>{
  const f=migrationFixture(),edited=f.getCurrent();edited.nodes[0].name='Human edit';
  await assert.rejects(migrateWorkflow({...f.options,current:edited}),/GRAPH_CHANGED/);assert.equal(f.calls.length,0);
  f.options.state.migrationPhase='UPDATE_SENDING';await assert.rejects(migrateWorkflow({...f.options,current:f.getCurrent()}),/UNCERTAIN_NO_RETRY/);assert.equal(f.calls.length,0);
});
test('a successful but unacknowledged graph replacement is reconciled by GET without another PUT',async()=>{
  const f=migrationFixture();f.options.state.workflowBackup={hash:'retained'};f.options.state.migrationPhase='UPDATE_SENDING';
  const current={...structuredClone(f.options.desired),active:false};
  const result=await migrateWorkflow({...f.options,current,api:async(method,suffix)=>{f.calls.push([method,suffix]);return {...current,active:true};}});
  assert.equal(result.active,true);assert.ok(!f.calls.some(c=>c[0]==='PUT'));
});
test('explicit rollback restores the saved graph inactive and never deletes CRM data',async()=>{
  const f=migrationFixture(),original=f.getCurrent();await migrateWorkflow({...f.options,current:original});
  const result=await restoreWorkflow({...f.options,current:f.getCurrent(),original});
  assert.equal(result.status,'CRM_SYNC_WORKFLOW_RESTORED_INACTIVE');assert.equal(f.getCurrent().active,false);assert.equal(result.crmRowsDeleted,0);
  assert.ok(compareCanaryGraph(f.options.expectedOld,f.getCurrent()).graphMatches);
});
test('batch timeout reconciles by read-only verify and never repeats append',async()=>{
  const f=fixture(),state={},calls=[];
  const call=async body=>{calls.push(body.mode);const p=f.plan(f.request(body.mode,body.rows,body.batchId));if(body.mode==='preview')return sync('preview',{plan:p});if(body.mode==='append'){f.commit(p);throw Error('fictional timeout');}return sync('verify',{plan:p,response:f.response(),sheets:f.sheets});};
  await assert.rejects(synchronizeBatch({rows:[person],batchId,call,state,save:async()=>{}}),/timeout/);assert.equal(state.phase,'UNCERTAIN');
  const result=await synchronizeBatch({rows:[person],batchId,call,state,save:async()=>{}});assert.equal(result.status,'READBACK_CONFIRMED');assert.equal(result.crmWrites,0);assert.deepEqual(calls,['preview','append','verify']);
});
test('uncommitted uncertain batch remains blocked and report excludes private errors',async()=>{
  const state={phase:'UNCERTAIN'};let calls=0;
  await assert.rejects(synchronizeBatch({rows:[person],batchId,state,save:async()=>{},call:async body=>{calls++;assert.equal(body.mode,'verify');throw Error('CRM_SYNC_UNCERTAIN_WRITE_NOT_RECONCILED');}}),/NOT_RECONCILED/);
  assert.equal(calls,1);assert.equal(state.phase,'UNCERTAIN');assert.ok(!JSON.stringify(reportFailure(Error('private-secret'))).includes('private-secret'));
});
