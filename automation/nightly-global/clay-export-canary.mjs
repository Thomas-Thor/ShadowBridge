// A local, private conversion of an OWNER-exported Clay CSV, not a Clay API or
// automatic sourcing client. No emails/phones, provider requests or credits.
import {readFile,mkdir,writeFile,lstat,realpath} from 'node:fs/promises';import {homedir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
export function clayCsvPayload(text,{kind,batchId}={}){
 const must=(v,c)=>{if(!v)throw Error(c);};must(['company','person'].includes(kind)&&typeof text==='string'&&text.length<=2097152,'CLAY_CSV_INPUT_INVALID');
 text=text.replace(/^\uFEFF/,'');let comma=0,semi=0,inside=false;for(const c of text){if(c==='"')inside=!inside;if(!inside&&/[\r\n]/.test(c))break;if(!inside){if(c===',')comma++;if(c===';')semi++;}}const delimiter=semi>comma?';':',';
 const records=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(closed&&c===' ')continue;
  if(c==='"'){must(!cell&&!closed,'CLAY_CSV_QUOTING_INVALID');quoted=true;continue;}
  if(c===delimiter){row.push(cell);cell='';closed=false;continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))records.push(row);row=[];cell='';closed=false;continue;}
  must(!closed,'CLAY_CSV_QUOTING_INVALID');cell+=c;
 }
 must(!quoted,'CLAY_CSV_QUOTING_INVALID');row.push(cell);if(row.some(v=>v!==''))records.push(row);must(records.length>=2&&records.length<=6,'CANARY_CSV_MAXIMUM_FIVE_ROWS');
 const norm=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[łŁ]/g,'l').toLowerCase().replace(/[^a-z0-9]/g,''),headers=records.shift().map(norm);
 const pick=(r,aliases)=>{for(const name of aliases){const ix=headers.flatMap((h,i)=>h===name?[i]:[]);must(ix.length<=1,'CLAY_CSV_DUPLICATE_HEADER');if(ix.length&&r[ix[0]]?.trim())return r[ix[0]].trim();}return'';};
 const rows=records.map(r=>{must(r.length===headers.length,'CLAY_CSV_COLUMN_COUNT_INVALID');const v={company:pick(r,kind==='company'?['companyname','company','name','nazwafirmy']:['companyname','company','nazwafirmy']),country:pick(r,['companycountry','krajfirmy','country','kraj']),industry:pick(r,['industry','sector','branza']),website:pick(r,['companywebsite','website','websiteurl','companydomain','domain','stronawww']),companyLinkedIn:pick(r,kind==='company'?['companylinkedinurl','linkedincompanyurl','linkedinurl','linkedin']:['companylinkedinurl','linkedincompanyurl']),sourceId:pick(r,['clayrowid','rowid','sourceid']),fullName:'',title:'',personLinkedIn:''};
  if(kind==='person'){v.fullName=pick(r,['fullname','contactname','name','imieinazwisko']);if(!v.fullName){const first=pick(r,['firstname']),last=pick(r,['lastname']);if(first&&last)v.fullName=first+' '+last;}must(v.fullName,'CLAY_PERSON_FULL_NAME_REQUIRED');v.title=pick(r,['jobtitle','title','position','stanowisko']);v.personLinkedIn=pick(r,['linkedinprofileurl','linkedinprofile','personlinkedin','linkedinurl','linkedin']);}
  return v;
 });return{mode:'preview',batchId,rows};
}
export async function main(args=process.argv.slice(2)){
 const file=args.find(v=>v.startsWith('--csv='))?.slice(6),kind=args.find(v=>v.startsWith('--kind='))?.slice(7);if(!file||args.length!==2)throw Error('USE_CSV_AND_KIND_COMPANY_OR_PERSON');
 const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)throw Error('CLAY_CSV_REGULAR_SMALL_FILE_REQUIRED');
 const batchId=randomUUID(),payload=clayCsvPayload(await readFile(file,'utf8'),{kind,batchId}),dir=path.join(homedir(),'.local/state/shadowbridge-sourcing-v1/clay-canary-input');await mkdir(dir,{recursive:true,mode:0o700});const st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&511)!==448||st.uid!==process.getuid()||await realpath(dir)!==dir)throw Error('PRIVATE_CANARY_DIRECTORY_REQUIRED');const output=dir+'/'+batchId+'.json';await writeFile(output,JSON.stringify(payload,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({status:'PRIVATE_CSV_CONVERTED_NOT_UPLOADED',rows:payload.rows.length,file:output,providerCalls:0,crmWrites:0}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z_]{4,120}$/.test(e.message||'')?e.message:'CLAY_LOCAL_CONVERSION_FAILED',providerCalls:0,crmWrites:0}));process.exitCode=1;});
