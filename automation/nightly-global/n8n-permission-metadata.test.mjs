import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {inspectN8nPermissionMetadata as inspect} from './n8n-permission-metadata.mjs';
const secret='FICTIONAL_PRIVATE_N8N_TOKEN',input={keyHash:createHash('sha256').update(secret).digest('hex'),googleId:'fictionalGoogle',projectId:'fictionalProject'};
function fixture({create=false,keyRows,role='global:owner',member=true,throwQuery,readOnly='on'}={}){
 const calls=[],configs=[],state={connected:false,ended:false},env={DB_TYPE:'postgresdb',DB_POSTGRESDB_USER:'fictional_n8n',DB_POSTGRESDB_PASSWORD:'FICTIONAL_DB_PASSWORD'};
 const columns=Object.entries({user_api_keys:['apiKey','scopes','userId'],user:['id','roleSlug','disabled'],credentials_entity:['id','name','type'],shared_credentials:['credentialsId','projectId'],project_relation:['userId','projectId','role'],workflow_entity:['id','name'],shared_workflow:['workflowId','projectId']}).flatMap(([t,cs])=>cs.map(c=>({table_name:t,column_name:c})));
 class Client{
  constructor(config){configs.push(config);}async connect(){state.connected=true;}async end(){state.ended=true;}
  async query(sql,params){calls.push({sql,params});if(throwQuery&&sql.includes(throwQuery))throw Error(secret);
   if(sql==='BEGIN READ ONLY'||sql==='ROLLBACK')return{rows:[]};if(sql==='SHOW transaction_read_only')return{rows:[{transaction_read_only:readOnly}]};
   if(sql.includes('information_schema.columns'))return{rows:columns};
   if(sql.startsWith('SELECT "userId","scopes"'))return{rows:keyRows??[{userId:'FICTIONAL_PRIVATE_OWNER_ID',scopes:['workflow:list',...(create?['credential:create']:[])]}]};
   if(sql.startsWith('SELECT "roleSlug"'))return{rows:[{roleSlug:role,disabled:false}]};
   if(sql.startsWith('SELECT "id","name","type"'))return{rows:[{id:input.googleId,name:'Google Sheets account',type:'googleSheetsOAuth2Api'}]};
   if(sql.startsWith('SELECT "projectId"'))return{rows:[{projectId:input.projectId}]};if(sql.startsWith('SELECT "role"'))return{rows:member?[{role:'project:personalOwner'}]:[]};
   if(sql.startsWith('SELECT count(*)'))return{rows:[{count:0}]};throw Error('UNEXPECTED_QUERY');
  }
 }
 return{calls,configs,state,env,loadPg:async()=>({Client})};
}
test('read-only metadata identifies the exact key by server-side hash and exposes only needed scope/role/project facts',async()=>{
 const f=fixture(),r=await inspect(input,f);assert.equal(r.status,'METADATA_READ_ONLY_CONFIRMED');assert.equal(r.diagnosis,'EXACT_KEY_LACKS_CONFIGURED_CREDENTIAL_CREATE_SCOPE');assert.equal(r.configuredScopeChecks['credential:create'],false);assert.equal(r.configuredScopeChecks['workflow:list'],true);assert.equal(r.keyOwnerGlobalRole,'global:owner');assert.equal(r.googleCredentialSharedWithTarget,true);assert.equal(r.matchingIngressCredentials,0);assert.equal(r.matchingWorkflowCount,0);
 const out=JSON.stringify(r);for(const hidden of [secret,input.keyHash,'FICTIONAL_DB_PASSWORD','FICTIONAL_PRIVATE_OWNER_ID'])assert.ok(!out.includes(hidden));assert.equal(r.keyTokenSelected,false);assert.equal(r.credentialDataSelected,false);assert.ok(f.configs[0].options.includes('default_transaction_read_only=on'));assert.ok(f.calls.every(c=>/^(SELECT|SHOW|BEGIN READ ONLY|ROLLBACK)/.test(c.sql)));assert.equal(f.calls[0].sql,'BEGIN READ ONLY');assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.state.ended,true);
 const key=f.calls.find(c=>c.sql.startsWith('SELECT "userId","scopes"'));assert.deepEqual(key.params,[input.keyHash]);assert.ok(key.sql.includes('sha256(convert_to("apiKey"'));assert.ok(!key.sql.split(' FROM ')[0].includes('"apiKey"'));assert.ok(!f.calls.some(c=>c.sql.includes('"data"')||c.sql.includes('password')||c.sql.includes('mfaSecret')));
});
test('present key scope does not pretend to explain a native denial or authorize deployment',async()=>{
 const r=await inspect(input,fixture({create:true}));assert.equal(r.diagnosis,'KEY_CREATE_SCOPE_PRESENT_REQUIRES_NATIVE_POLICY_REVIEW');assert.equal(r.apiAuthorizationNotOverridden,true);assert.equal(r.apiWrites,0);
 const member=await inspect(input,fixture({create:true,role:'global:member',member:false}));assert.equal(member.diagnosis,'TARGET_PROJECT_MEMBERSHIP_REQUIRES_REVIEW');
});
test('unknown key, ambiguous identity and server errors stop without printing DB tokens or raw errors',async()=>{
 for(const keyRows of [[],[{userId:'one',scopes:[]},{userId:'two',scopes:[]}]]){const f=fixture({keyRows}),r=await inspect(input,f);assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'EXACT_KEY_NOT_UNIQUELY_IDENTIFIED');assert.equal(f.calls.at(-1).sql,'ROLLBACK');}
 const f=fixture({throwQuery:'information_schema.columns'}),r=await inspect(input,f);assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'METADATA_READ_NOT_CONFIRMED');assert.ok(!JSON.stringify(r).includes(secret));assert.equal(f.state.ended,true);
});
test('invalid input, table identifiers, unsafe TLS and read-write transactions cannot reach metadata reads',async()=>{
 const invalid=fixture();assert.equal((await inspect({...input,keyHash:'not-a-fingerprint'},invalid)).status,'BLOCKED');assert.equal(invalid.state.connected,false);
 const bad=fixture();bad.env.DB_TABLE_PREFIX=';DROP';assert.equal((await inspect(input,bad)).reason,'DATABASE_IDENTIFIERS_INVALID');assert.equal(bad.state.connected,false);
 const tls=fixture();Object.assign(tls.env,{DB_POSTGRESDB_SSL_ENABLED:'true',DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED:'false'});assert.equal((await inspect(input,tls)).reason,'DATABASE_TLS_REQUIRED');assert.equal(tls.state.connected,false);
 const rw=fixture({readOnly:'off'});assert.equal((await inspect(input,rw)).reason,'READ_ONLY_REQUIRED');assert.equal(rw.calls.some(c=>c.sql.includes('FROM')),false);assert.equal(rw.calls.at(-1).sql,'ROLLBACK');
});
