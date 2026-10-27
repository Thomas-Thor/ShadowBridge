import {ApiError} from './validation.mjs';
import {sha256} from './workspace-crypto.mjs';
const fail=message=>{throw new ApiError(400,'INVALID_CSV',message);};
const normalized=v=>String(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const csvFields=Object.freeze({
 contactId:['idkontaktu','contactid'],companyId:['idfirmy','companyid'],sourceId:['id','sourceid','recordid','clayid'],
 fullName:['name','fullname','imienazwisko','osoba','osobakontaktowa'],firstName:['firstname','imie'],lastName:['lastname','nazwisko'],
 company:['company','companyname','firma','kontrahent'],title:['jobtitle','title','stanowisko','funkcja'],department:['department','dzial'],
 country:['country','kraj'],industry:['industry','sector','branza'],companyType:['companytype','typ'],products:['products','produkty'],
 website:['website','stronawww','strona','companywebsite'],domain:['domain','companydomain','domena'],
 email:['workemail','email','businessemail'],phone:['phone','telefon'],linkedin:['linkedin','linkedinurl','professionallink'],
 source:['source','zrodlo','claytask'],notes:['notes','uwagi'],photo:['photofile','zdjecie','photo'],cv:['cvfile','cv'],
});
export function parseCsv(content,{delimiter}={}){
 if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>2_000_000||content.includes('\0')||content.includes('\ufffd'))fail('Use a UTF-8 CSV of at most 2 MB without invalid characters.');
 content=content.replace(/^\uFEFF/,'');
 if(delimiter!==undefined&&![';',',','\t'].includes(delimiter))fail('Choose comma, semicolon or tab.');
 if(!delimiter){
  const first=content.split(/\r?\n/)[0]??'';let quoted=false;const counts={';':0,',':0,'\t':0};
  for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted&&Object.hasOwn(counts,first[i]))counts[first[i]]++;}
  delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];if(counts[delimiter]===0)delimiter=',';
 }
 const rows=[];let row=[],field='',quoted=false,afterQuote=false;
 const addField=()=>{if(field.length>16000)fail('A CSV field exceeds 16,000 characters.');row.push(field);field='';afterQuote=false;if(row.length>60)fail('Use at most 60 columns.');};
 const addRow=()=>{addField();if(row.some(v=>v.trim()!==''))rows.push(row);row=[];if(rows.length>501)fail('Use at most 500 data rows per file.');};
 for(let i=0;i<content.length;i++){
  const c=content[i];
  if(quoted){if(c==='"'){if(content[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
  if(c==='"'){if(field||afterQuote)fail('Unexpected quote in CSV.');quoted=true;continue;}
  if(c===delimiter){addField();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&content[i+1]==='\n')i++;addRow();continue;}
  if(afterQuote){if(c===' '||c==='\t')continue;fail('Unexpected text after closing quote.');}
  field+=c;
 }
 if(quoted)fail('A quoted CSV field is not closed.');if(field||row.length||afterQuote)addRow();
 if(rows.length<2)fail('Include a header and at least one data row.');
 const headers=rows.shift().map(s=>s.trim());if(headers.some(s=>!s||s.length>120)||new Set(headers.map(normalized)).size!==headers.length)fail('Use distinct, non-empty column names.');
 const width=headers.length;if(rows.some(r=>r.length!==width))fail('Every row must have the same number of columns as the header.');
 return {headers,rows,delimiter};
}
export function autoMapping(headers){
 const mapping={},used=new Set();
 for(const [field,aliases] of Object.entries(csvFields)){
  const hits=headers.map((h,i)=>aliases.includes(normalized(h))?i:-1).filter(i=>i>=0);
  if(hits.length===1&&!used.has(hits[0])){mapping[field]=headers[hits[0]];used.add(hits[0]);}
 }
 return mapping;
}
export function canonicalLinkedIn(value){
 if(!value)return '';let u;try{u=new URL(value);}catch{return null;}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!/(^|\.)linkedin\.com$/i.test(u.hostname)||!/^\/in\/[^/]+\/?$/.test(u.pathname))return null;
 return 'https://www.linkedin.com'+u.pathname.replace(/\/$/,'').toLowerCase();
}
export function companyDomain(value){
 if(!value)return '';let u;try{u=new URL(/^[a-z]+:\/\//i.test(value)?value:'https://'+value);}catch{return null;}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname))return null;
 return u.hostname.replace(/^www\./,'').toLowerCase();
}
export function prepareCsv(content,{mapping,delimiter,kind='contacts'}={}){
 const parsed=parseCsv(content,{delimiter});mapping=mapping??autoMapping(parsed.headers);
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).some(k=>!Object.hasOwn(csvFields,k))||Object.values(mapping).some(v=>typeof v!=='string'||!parsed.headers.includes(v))||new Set(Object.values(mapping)).size!==Object.values(mapping).length)fail('Choose each existing column at most once.');
 if(!['contacts','companies'].includes(kind)||!mapping.company||(kind==='contacts'&&!mapping.fullName&&!(mapping.firstName&&mapping.lastName)))fail('Map company and, for contacts, full name or first and last name.');
 const seen=new Set(),records=[],issues=[];
 parsed.rows.forEach((cells,index)=>{
  const value=key=>mapping[key]?cells[parsed.headers.indexOf(mapping[key])].trim():'';
  const domain=companyDomain(value('domain')||value('website')),linkedin=canonicalLinkedIn(value('linkedin'));
  const r=Object.fromEntries(Object.keys(csvFields).map(k=>[k,value(k)]));r.fullName=r.fullName||[r.firstName,r.lastName].filter(Boolean).join(' ');r.domain=domain??'';r.linkedin=linkedin??'';r.kind=kind;
  const rowIssues=[];if(r.company.length<2||r.company.length>200)rowIssues.push('COMPANY_REQUIRED');
  if(kind==='contacts'&&(r.fullName.length<2||r.fullName.length>200))rowIssues.push('NAME_REQUIRED');
  if(domain===null)rowIssues.push('INVALID_DOMAIN');if(linkedin===null)rowIssues.push('INVALID_LINKEDIN');
  if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))rowIssues.push('INVALID_EMAIL');
  for(const k of ['title','department','country','industry','companyType','sourceId','contactId','companyId'])if(r[k].length>200)rowIssues.push('FIELD_TOO_LONG');
  if(r.email.length>254||r.phone.length>100||r.website.length>500||r.notes.length>4000||r.products.length>1000)rowIssues.push('FIELD_TOO_LONG');
  const companyKey=r.companyId||[normalized(r.company),domain,r.country.toLowerCase()].join(':');
  const identity=kind==='companies'?'company:'+companyKey:r.contactId?'contact:'+r.contactId:r.linkedin?'linkedin:'+r.linkedin:r.sourceId?'source:'+r.source+':'+r.sourceId:r.email?'email:'+r.email.toLowerCase()+':'+companyKey:'';
  if(!identity)rowIssues.push('STRONG_IDENTITY_REQUIRED');
  if(identity&&seen.has(identity))rowIssues.push('DUPLICATE_IN_FILE');if(identity)seen.add(identity);
  r.row=index+2;r.rowKey=sha256(identity||'invalid:'+index);r.extras=Object.fromEntries(parsed.headers.filter(h=>!Object.values(mapping).includes(h)).map(h=>[h,cells[parsed.headers.indexOf(h)]]));
  records.push(r);if(rowIssues.length)issues.push({row:r.row,codes:[...new Set(rowIssues)]});
 });
 return {headers:parsed.headers,mapping,delimiter:parsed.delimiter,kind,total:records.length,records,issues,unmapped:parsed.headers.filter(h=>!Object.values(mapping).includes(h)),hash:sha256({mapping,kind,records})};
}
export function safeCsvCell(value){const s=String(value??'');const safe=/^[\s]*[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replaceAll('"','""')+'"';}
