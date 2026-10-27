import test from 'node:test';import assert from 'node:assert/strict';import {buildClayCanary} from './build-clay-canary.mjs';import {compareCanaryGraph} from './n8n-workflow-graph.mjs';
function fixture(){const t=buildClayCanary({spreadsheetId:'fictionalSpreadsheetIdentifier123456',googleCredentialId:'google1',ingestCredentialId:'header1'});const expected={name:t.name,nodes:t.nodes,connections:t.connections,settings:t.settings};return{expected,current:structuredClone(expected)};}
test('exact submitted graph retains the prior handling of server-added settings defaults',()=>{
 const f=fixture();f.current.settings.callerPolicy='workflowsFromSameOwner';const r=compareCanaryGraph(f.expected,f.current);assert.equal(r.graphMatches,true);assert.equal(r.differenceCount,0);assert.equal(r.knownDisplayLabelNormalizations.length,0);
});
test('only the documented exact ingress display-label pair with unchanged node, type and credential ID is normalized',()=>{
 const f=fixture(),original=JSON.stringify(f.expected);f.current.nodes[0].credentials.httpHeaderAuth.name='ShadowBridge private Clay intake';const native=JSON.stringify(f.current),r=compareCanaryGraph(f.expected,f.current);assert.equal(r.graphMatches,true);assert.equal(r.knownDisplayLabelNormalizations.length,1);assert.equal(r.comparisonGraphHash,r.actualComparedGraphHash);assert.notEqual(r.expectedGraphHash,r.actualComparedGraphHash);assert.equal(JSON.stringify(f.expected),original);assert.equal(JSON.stringify(f.current),native);assert.equal(r.serverWorkflowUpdated,false);
});
test('different ID, removed auth, changed code, URL, method, topology and unrelated credential labels remain blocking',()=>{
 const changes=[f=>f.current.nodes[0].credentials.httpHeaderAuth.id='other',f=>f.current.nodes[0].parameters.authentication='none',f=>f.current.nodes[0].type='n8n-nodes-base.httpRequest',f=>f.current.nodes[1].parameters.jsCode='UNAPPROVED_CODE',f=>f.current.nodes[2].parameters.url='https://unapproved.invalid',f=>f.current.nodes[2].parameters.method='POST',f=>f.current.connections={},f=>f.current.nodes[2].credentials.googleSheetsOAuth2Api.name='Unexpected label'];
 for(const change of changes){const f=fixture();f.current.nodes[0].credentials.httpHeaderAuth.name='ShadowBridge private Clay intake';change(f);const r=compareCanaryGraph(f.expected,f.current);assert.equal(r.graphMatches,false);assert.ok(r.differenceCount>0);}
});
test('difference evidence exposes hashes and trusted field paths but no parameter values or server-added private keys',()=>{
 const f=fixture();f.current.nodes[1].parameters.jsCode='PRIVATE_ACCESS_TOKEN_FICTIONAL';f.current.nodes[2].parameters.url='https://private.invalid/PRIVATE_CRM_ID';f.current.nodes[0]['PRIVATE_SERVER_FIELD']='PRIVATE_SERVER_VALUE';
 const r=compareCanaryGraph(f.expected,f.current),out=JSON.stringify(r);assert.equal(r.redacted,true);assert.equal(r.graphMatches,false);for(const secret of ['PRIVATE_ACCESS_TOKEN_FICTIONAL','PRIVATE_CRM_ID','PRIVATE_SERVER_FIELD','PRIVATE_SERVER_VALUE'])assert.ok(!out.includes(secret));assert.ok(r.differences.some(d=>d.path.endsWith('.parameters.jsCode')));assert.ok(r.differences.some(d=>d.path.endsWith('[server-added-field]')));
});
test('difference reports are bounded and never call a partial comparison a match',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.current.nodes[0]['extra'+i]=i;const r=compareCanaryGraph(f.expected,f.current);assert.equal(r.graphMatches,false);assert.equal(r.differences.length,80);assert.equal(r.differencesTruncated,true);assert.equal(r.differenceCount,100);
});
