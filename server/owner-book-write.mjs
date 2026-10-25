// Small bridge to the existing Book validator/save engine, not another API.
import {createHash,randomUUID} from 'node:crypto';
import {bookKinds,bookRecord} from './owner-book.mjs';
import {ApiError,object,identifier,oneOf} from './validation.mjs';
export const writeScopes=Object.freeze(bookKinds.map(k=>k+'.write'));
const mutable=['title','body','priority','status','due_at','starts_at','ends_at','remind_at','archived','dependencies','source_ref'];
const properties={title:{type:'string',maxLength:200},body:{type:'string',maxLength:5000},priority:{enum:['low','normal','high','critical']},status:{enum:['planned','open','in_progress','blocked','done','cancelled','recorded']},source_ref:{type:'string',maxLength:500},archived:{type:'boolean'},dependencies:{type:'array',maxItems:20,items:{type:'string',format:'uuid'}},...Object.fromEntries(['due_at','starts_at','ends_at','remind_at'].map(k=>[k,{type:['string','null'],format:'date-time'}]))};
const meta={requestKey:{type:'string',format:'uuid'},explicitWrite:{type:'boolean',const:true}};
const annotations={readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false};
export const bookWriteTools=Object.freeze([
 {name:'create_book_entry',title:'Create an OWNER Book entry',description:'Create ONE note, task, idea, calendar event or decision only on an explicit OWNER command. Requires its .read and .write scopes separately approved with OWNER MFA. Use a stable operation UUID; read back the returned ID. No CRM, keys, deletion, imports or journal writes. Event timestamps require an explicit UTC offset; in-app reminders are not email/push delivery.',inputSchema:{type:'object',additionalProperties:false,required:['entry','requestKey','explicitWrite'],properties:{entry:{type:'object',additionalProperties:false,required:['kind','title'],properties:{kind:{enum:bookKinds},...properties}},...meta}},annotations},
 {name:'update_book_entry',title:'Update an existing OWNER Book entry',description:'Update only the requested fields of one previously read Book entry, using its ID, kind and current version. Requires explicit OWNER instruction and .read/.write scope. The server preserves unspecified fields, rejects stale versions and incomplete task dependencies, and records history. Use the same operation UUID when retrying. No deletion, CRM, journal edits or permission management.',inputSchema:{type:'object',additionalProperties:false,required:['id','kind','version','changes','requestKey','explicitWrite'],properties:{id:{type:'string',format:'uuid'},kind:{enum:bookKinds},version:{type:'integer',minimum:1},changes:{type:'object',additionalProperties:false,minProperties:1,properties},...meta}},annotations}
]);
export function writeInput(name,args){
 const update=name==='update_book_entry';if(!update&&name!=='create_book_entry')throw new ApiError(400,'BOOK_INVALID_INPUT','Use an advertised write tool.');
 object(args,update?['id','kind','version','changes','requestKey','explicitWrite']:['entry','requestKey','explicitWrite'],update?['id','kind','version','changes','requestKey','explicitWrite']:['entry','requestKey','explicitWrite']);
 if(args.explicitWrite!==true)throw new ApiError(403,'BOOK_EXPLICIT_WRITE_REQUIRED','An explicit OWNER command is required.');
 const requestKey=identifier(args.requestKey);
 if(!update){const record=bookRecord(args.entry);return{kind:record.kind,action:'save',params:record,requestKey,explicitWrite:true};}
 const kind=oneOf(args.kind,bookKinds,'kind'),id=identifier(args.id);if(!Number.isSafeInteger(args.version)||args.version<1)throw new ApiError(400,'BOOK_INVALID_INPUT','Use the previously read record version.');
 object(args.changes,mutable,[]);if(!Object.keys(args.changes).length)throw new ApiError(400,'BOOK_INVALID_INPUT','Specify only the fields to change.');
 return{kind,action:'patch',params:{id,version:args.version,changes:args.changes},requestKey,explicitWrite:true};
}
export async function routeBookWrite({req,name,args,sessionPool,clientHash}){
 const token=/^Bearer (sboa_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');if(!token)return{status:401,data:{code:'BOOK_API_DENIED'}};
 const token_hash=createHash('sha256').update(token[1]).digest('hex'),resource='https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp';
 const rpc=async input=>(await sessionPool.query('SELECT owner_book.oauth_write_rpc($1::jsonb,$2,$3::uuid) AS result',[JSON.stringify({...input,token_hash,resource}),clientHash,randomUUID()])).rows[0].result;
 try{
 const input=writeInput(name,args);
 if(input.action==='patch'){
  const read=(await sessionPool.query('SELECT owner_book.oauth_machine($1,$2::jsonb,$3,$4::uuid) AS result',['read',JSON.stringify({token_hash,resource,action:'get',kind:input.kind,params:{id:input.params.id}}),clientHash,randomUUID()])).rows[0].result;if(read.status!==200)return read;
  const current=Object.fromEntries(['kind',...mutable].filter(k=>Object.hasOwn(read.data,k)).map(k=>[k,read.data[k]]));
  const validated=bookRecord({...current,...input.params.changes,kind:input.kind,version:input.params.version},{update:true,id:input.params.id});
  input.params.changes=Object.fromEntries(Object.keys(input.params.changes).map(k=>[k,validated[k]]));
 }
 return await rpc(input);
 }catch(e){
  if(!e.status)throw e;
  // Audit the rejected operation without persisting untrusted/secret fields.
  const denied=await rpc({action:'invalid',kind:null,params:{},explicitWrite:false});
  if([401,429].includes(denied.status))return denied;throw e;
 }
}
