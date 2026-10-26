import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {spawnSync} from 'node:child_process';
import {readN8nAcquisitionMetadata,acquisitionMetadataCode} from './credential-inventory.mjs';
test('actual SQLite metadata returns only buckets/counts, leaves bytes unchanged and never reads encrypted credential data',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'sb-acquisition-metadata-'));await mkdir(root+'/.n8n');const file=root+'/.n8n/database.sqlite',db=new DatabaseSync(file);
 db.exec('CREATE TABLE credentials_entity(type TEXT,name TEXT,data TEXT)');const add=db.prepare('INSERT INTO credentials_entity VALUES(?,?,?)');
 for(const [type,name]of [['httpHeaderAuth','PRIVATE Apollo key'],['httpHeaderAuth','PRIVATE Clay key'],['googleSheetsOAuth2Api','PRIVATE spreadsheet'],['googleApi','PRIVATE service account'],['httpHeaderAuth','PRIVATE unknown source']])add.run(type,name,'PRIVATE_ENCRYPTED_DATA');db.close();
 const before=await readFile(file),r=await readN8nAcquisitionMetadata({env:{DB_TYPE:'sqlite',N8N_USER_FOLDER:root}});
 assert.equal(r.status,'METADATA_READ_ONLY');assert.equal(r.totalCredentials,5);for(const k of ['apolloHint','clayHint','googleSheetsOAuth','googleServiceAccount','genericHttpUnclassified'])assert.equal(r.credentialCandidates[k],1);
 assert.equal(r.authorizationVerified,false);assert.equal(r.encryptedCredentialDataRead,false);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.deepEqual(await readFile(file),before);
});
test('PostgreSQL uses enforced READ ONLY and a metadata aggregate without credential values or writes',async()=>{
 const queries=[];let opts,ended=false;class Client{constructor(o){opts=o;}async connect(){}async query(q){queries.push(q);if(q==='SHOW transaction_read_only')return{rows:[{transaction_read_only:'on'}]};if(q.startsWith('SELECT'))return{rows:[{bucket:'googleSheetsOAuth',count:1}]};return{rows:[]};}async end(){ended=true;}}
 const r=await readN8nAcquisitionMetadata({env:{DB_TYPE:'postgresdb',DB_POSTGRESDB_PASSWORD:'PRIVATE_PASSWORD'},loadPg:async()=>({Client})});
 assert.equal(r.status,'METADATA_READ_ONLY');assert.equal(r.credentialCandidates.googleSheetsOAuth,1);assert.ok(opts.options.includes('default_transaction_read_only=on'));assert.ok(queries.includes('BEGIN READ ONLY'));assert.equal(queries.at(-1),'ROLLBACK');assert.ok(ended);
 const sql=queries.find(q=>q.startsWith('SELECT'));assert.ok(!/\b(data|id)\b/i.test(sql));assert.ok(!queries.some(q=>/UPDATE|INSERT|DELETE|CREATE|ALTER|GRANT/i.test(q)));assert.ok(!JSON.stringify(r).includes('PRIVATE_PASSWORD'));
});
test('invalid schema, unsupported DB and insecure TLS remain unverified without leaking configuration',async()=>{
 for(const env of [{DB_TYPE:'postgresdb',DB_POSTGRESDB_SCHEMA:'bad;PRIVATE'},{DB_TYPE:'unsupported'},{DB_TYPE:'postgresdb',DB_POSTGRESDB_SSL_ENABLED:'true',DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED:'false'}]){
  const r=await readN8nAcquisitionMetadata({env,loadPg:async()=>({Client:class{constructor(){throw Error('PRIVATE_ERROR');}}})});assert.ok(r.status.startsWith('METADATA_NOT_VERIFIED'));assert.equal(r.authorizationVerified,false);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 }
});
test('standalone operator refuses the workspace before touching Docker; generated reader has no export or decryption',()=>{
 const p=spawnSync(process.execPath,[new URL('./credential-inventory.mjs',import.meta.url).pathname,'--read-only'],{encoding:'utf8'});assert.equal(p.status,2);const r=JSON.parse(p.stderr);assert.equal(r.changesMade,false);assert.equal(r.crmWrites,0);
 const code=acquisitionMetadataCode();assert.ok(!code.includes('export:credentials'));assert.ok(!code.includes('decrypt'));assert.ok(!code.includes('SELECT data'));
});
