// Dedicated disposable DB only. Never uses DATABASE_URL or production config.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
const connectionString=process.env.R2_TEST_DATABASE_URL;
if(!connectionString){test('native R2 database checks require the isolated R2_TEST_DATABASE_URL',{skip:true},()=>{});}
else{
 const parsed=new URL(connectionString);
 if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/shadowbridge_r2_test')throw Error('Refusing a non-isolated R2 test database');
 const admin=new pg.Client({connectionString});await admin.connect();
 const owner=randomUUID(),member=randomUUID(),outsider=randomUUID(),customer=randomUUID();
 const as=async(id,fn,{aal='aal2',fresh=true,role='shadowbridge_api'}={})=>{
  await admin.query('BEGIN');try{
   if(!['shadowbridge_api','shadowbridge_sessions'].includes(role))throw Error('Invalid role');await admin.query('SET LOCAL ROLE '+role);
   await admin.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.aal',$2,true),set_config('request.jwt.claim.mfa_verified_at',$3,true)",[id,aal,fresh?String(Math.floor(Date.now()/1000)):'1']);
   const v=await fn(admin);await admin.query('COMMIT');return v;
  }catch(e){await admin.query('ROLLBACK');throw e;}
 };
 const read=(id,operation,p={})=>as(id,async c=>(await c.query('SELECT command_center.chat_read($1,$2) data',[operation,p])).rows[0].data);
 const write=(id,operation,p)=>as(id,async c=>(await c.query('SELECT command_center.chat_write($1,$2) data',[operation,p])).rows[0].data);
 const denied=p=>assert.rejects(p,e=>['42501','40001','22023','23514'].includes(e.code));
 let room,oldMessage;
 test('native setup uses only fictional accounts in the disposable database',async()=>{
  for(const [id,kind]of [[owner,'owner'],[member,'staff_analyst'],[outsider,'staff_analyst'],[customer,null]]){
   await admin.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) VALUES($1,$2,now(),'{}','{}',now(),now())",[id,id+'@fictional.invalid']);
   if(kind){await admin.query('INSERT INTO sb.staff_grants(user_id,active) VALUES($1,true)',[id]);await admin.query('INSERT INTO sb.staff_role_assignments(user_id,role_key) VALUES($1,$2)',[id,kind]);}
  }
  await admin.query("INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,secret) VALUES($1,$2,'totp','verified',now(),now(),'FICTIONAL-TEST-ONLY')",[randomUUID(),owner]);
  for(const id of [member,outsider])await admin.query("INSERT INTO sb.staff_permission_overrides(user_id,permission,effect) VALUES($1,'messages.read','allow'),($1,'messages.create','allow')",[id]);
 });
 test('raw workspace tables, session role and non-OWNER access do not expose private records',async()=>{
  await denied(as(owner,c=>c.query('SELECT * FROM command_center.files')));await denied(as(owner,c=>c.query('SELECT * FROM command_center.imports')));await denied(as(owner,c=>c.query('SELECT * FROM owner_vault.contacts'),{role:'shadowbridge_sessions'}));
  await denied(as(member,c=>c.query("SELECT command_center.site_read('home',false)")));await denied(as(owner,c=>c.query("SELECT command_center.site_read('home',false)"),{aal:'aal1'}));
 });
 test('room creation requires fresh OWNER MFA and staff cannot grant themselves a room',async()=>{
  await denied(write(member,'create',{title:'Fictional room'}));await denied(as(owner,c=>c.query('SELECT command_center.chat_write($1,$2)',['create',{title:'Fictional room'}]),{fresh:false}));room=(await write(owner,'create',{title:'Fictional room'})).id;oldMessage=await write(owner,'send',{roomId:room,body:'FICTIONAL earlier message',requestKey:randomUUID()});
 });
 test('room grants support history boundaries and require explicit write permission',async()=>{
  await write(owner,'member',{roomId:room,userId:member,canWrite:false,canAttach:false,active:true,history:'from_now',expiresAt:null});assert.deepEqual((await read(member,'messages',{roomId:room})).items,[]);await denied(write(member,'send',{roomId:room,body:'Cannot send',requestKey:randomUUID()}));await denied(read(outsider,'messages',{roomId:room}));assert.equal((await read(customer,'rooms').catch(()=>({items:[]}))).items.length,0);
 });
 test('message retries are idempotent and changed payloads are refused',async()=>{
  await write(owner,'member',{roomId:room,userId:member,canWrite:true,canAttach:true,active:true,history:'all',expiresAt:null});const p={roomId:room,body:'FICTIONAL one message',requestKey:randomUUID()};const a=await write(member,'send',p),b=await write(member,'send',p);assert.equal(a.id,b.id);await denied(write(member,'send',{...p,body:'Changed'}));assert.ok((await read(member,'messages',{roomId:room})).items.some(x=>x.id===oldMessage.id));
 });
 test('revocation cuts off later reads, writes and member listing',async()=>{
  await denied(read(member,'members',{roomId:room}));await write(owner,'member',{roomId:room,userId:member,canWrite:true,canAttach:true,active:false,history:'all',expiresAt:null});await denied(read(member,'messages',{roomId:room}));await denied(write(member,'send',{roomId:room,body:'No longer allowed',requestKey:randomUUID()}));assert.equal((await read(member,'rooms')).items.some(x=>x.id===room),false);
 });
 let editor;
 test('draft content stays private and concurrent draft saves cannot overwrite',async()=>{
  editor=await as(owner,async c=>(await c.query("SELECT command_center.site_read('member-entry',false) data")).rows[0].data);const p={page:'member-entry',expectedVersion:editor.version,blocks:[{id:'test-heading',type:'heading',text:'FICTIONAL approved message',level:2}]};
  editor=await as(owner,async c=>(await c.query("SELECT command_center.site_write('save',$1) data",[p])).rows[0].data);await denied(as(owner,c=>c.query("SELECT command_center.site_write('save',$1)",[p])));const live=await as(customer,async c=>(await c.query("SELECT command_center.site_read('member-entry',true) data")).rows[0].data);assert.equal(live.blocks,null);
 });
 test('publishing requires fresh MFA and retains immutable rollback versions',async()=>{
  const p={page:'member-entry',expectedVersion:editor.version,revision:editor.items[0].id};await denied(as(owner,c=>c.query("SELECT command_center.site_write('publish',$1)",[p]),{fresh:false}));editor=await as(owner,async c=>(await c.query("SELECT command_center.site_write('publish',$1) data",[p])).rows[0].data);const live=await as(customer,async c=>(await c.query("SELECT command_center.site_read('member-entry',true) data")).rows[0].data);assert.equal(live.revision,editor.publishedId);assert.equal(live.blocks[0].text,'FICTIONAL approved message');
 });
 test('private file access never follows room membership or OWNER status in the UI alone',async()=>{
  await denied(as(member,c=>c.query("SELECT command_center.files_read('list',$1)",[{kind:'contact',parent:'sheets:FICTIONAL'}])));await denied(as(outsider,c=>c.query("SELECT command_center.files_read('list',$1)",[{kind:'room',parent:room}])));await denied(as(owner,c=>c.query("SELECT command_center.files_read('list',$1)",[{kind:'contact',parent:'sheets:UNKNOWN'}])));
 });
 test('morning reporter has only aggregate source grants, generates once and marks missing sources',async()=>{
  await as(owner,c=>c.query('SELECT command_center.refresh_briefings()'),{role:'shadowbridge_sessions'});assert.equal((await as(owner,c=>c.query('SELECT command_center.refresh_briefings() AS n'),{role:'shadowbridge_sessions'})).rows[0].n,0);const b=(await as(owner,c=>c.query('SELECT command_center.briefing_read() data'))).rows[0].data;assert.equal(b.items.length,1);assert.ok(b.items[0].payload.sources.every(x=>x.status==='NO_DATA'));assert.equal(b.items[0].payload.timezone,'Europe/Oslo');await denied(as(member,c=>c.query('SELECT command_center.briefing_read()')));
 });
 test('an import cannot be claimed without exact approval and an encrypted backup',async()=>{
  const i=(await as(owner,c=>c.query("SELECT command_center.import_write('prepare',$1) data",[{target:'sheets',hash:'a'.repeat(64),cipher:'aa'.repeat(40),total:1,preview:{newRows:1}}]))).rows[0].data;const claim={id:i.id,claimKey:randomUUID()};await denied(as(owner,c=>c.query("SELECT command_center.import_write('claim',$1)",[claim])));await as(owner,c=>c.query("SELECT command_center.import_write('approve',$1)",[{id:i.id,hash:i.payload_hash}]));await denied(as(owner,c=>c.query("SELECT command_center.import_write('claim',$1)",[claim])));await as(owner,c=>c.query("SELECT command_center.import_write('backup',$1)",[{id:i.id,cipher:'aa'.repeat(40),hash:'b'.repeat(64)}]));await as(owner,c=>c.query("SELECT command_center.import_write('claim',$1)",[claim]));await as(owner,c=>c.query("SELECT command_center.import_write('uncertain',$1)",[claim]));await denied(as(owner,c=>c.query("SELECT command_center.import_write('claim',$1)",[claim])));await denied(as(owner,c=>c.query("SELECT command_center.import_write('receipt',$1)",[{...claim,progress:1,receipt:{readbackConfirmed:false}}])));
 });
 after(async()=>{await admin.end();});
}
