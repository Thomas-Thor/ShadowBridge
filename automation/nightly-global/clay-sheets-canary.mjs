// Pure stages for ONE small authenticated Clay-export -> existing Sheets test.
// No Clay API, email/phone extraction, enrichment, network, secrets or timers.
export function claySheetsCanary(action,a){
 const must=(v,c)=>{if(!v)throw Error(c);},text=(v,n=300)=>typeof v==='string'?v.trim().slice(0,n):'';
 const normal=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[łŁ]/g,'l').toLowerCase().replace(/[^a-z0-9]/g,'');
 const profile=(v,type)=>{const m=new RegExp('^https?://(?:(?:www|[a-z]{2})\\.)?linkedin\\.com/'+type+'/([a-zA-Z0-9%_-]+)(?:[/?#].*)?$','i').exec(text(v,1000));return m?'https://www.linkedin.com/'+type+'/'+m[1].toLowerCase():'';};
 const domain=v=>{const m=/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)(?::\d+)?(?:[/?#].*)?$/i.exec(text(v,1000));return m&&m[1].includes('.')?m[1].toLowerCase():'';};
 const key=r=>r.fullName?(profile(r.personLinkedIn,'in')?'person:'+profile(r.personLinkedIn,'in'):r.sourceId?'person:clay:'+r.sourceId:''):(profile(r.companyLinkedIn,'company')?'company:'+profile(r.companyLinkedIn,'company'):r.sourceId?'company:clay:'+r.sourceId:domain(r.website)&&r.country?'company:domain:'+domain(r.website)+':'+normal(r.country):'');
 const comparable=v=>text(v,1000).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
 const same=(x,y)=>['company','country','industry','fullName','title','website','personLinkedIn'].every(f=>comparable(x[f])===comparable(y[f]));
 const fields=['sbKey','company','country','industry','fullName','title','website','personLinkedIn','source','emailStatus'];
 const aliases={sbKey:['shadowbridgeid','sbkey'],company:['company','companyname','nazwafirmy','firma'],country:['country','kraj'],industry:['industry','sector','branza'],fullName:['fullname','contactname','imieinazwisko'],title:['title','jobtitle','stanowisko'],website:['website','companywebsite','stronawww','stronainternetowa'],personLinkedIn:['linkedin','linkedinurl','personlinkedin','linkedinprofile'],source:['source','zrodlo'],emailStatus:['emailstatus','statusemail']};
 const unwrap=r=>{must(r?.statusCode===200,'GOOGLE_SHEETS_READ_NOT_CONFIRMED');must(r.body&&typeof r.body==='object','GOOGLE_SHEETS_RESPONSE_INVALID');return r.body;};
 const mapHeaders=values=>{must(Array.isArray(values)&&Array.isArray(values[0]),'CRM_HEADER_ROW_REQUIRED');const h=values[0].map(normal),map={};for(const f of fields){const found=h.map((v,i)=>aliases[f].includes(v)?i:-1).filter(i=>i>=0),label=f.replace(/[A-Z]/g,c=>'_'+c).toUpperCase();must(found.length!==0,'CRM_REQUIRED_COLUMN_MISSING_'+label);must(found.length===1,'CRM_AMBIGUOUS_COLUMN_'+label);map[f]=found[0];}return map;};
 if(action==='validate'){
  const b=a.body;must(b&&['inspect','preview','append','verify'].includes(b.mode)&&/^[A-Za-z0-9_-]{16,80}$/.test(b.batchId||''),'CANARY_REQUEST_INVALID');
  if(b.mode==='inspect'){must(!b.rows||Array.isArray(b.rows)&&b.rows.length===0,'CANARY_INSPECT_NO_RECORDS_ALLOWED');return{mode:'inspect',batchId:b.batchId,rows:[]};}
  must(Array.isArray(b.rows)&&b.rows.length>0&&b.rows.length<=5,'CANARY_MAXIMUM_FIVE_ROWS');
  const rows=b.rows.map(v=>{must(v&&typeof v==='object'&&!Array.isArray(v),'CANARY_ROW_INVALID');const r={};for(const f of ['company','country','industry','fullName','title','website','personLinkedIn','companyLinkedIn','sourceId'])r[f]=text(v[f],f.includes('LinkedIn')||f==='website'?1000:300);must(r.company,'CANARY_COMPANY_REQUIRED');r.sbKey=key(r);must(r.sbKey,'CANARY_STABLE_IDENTITY_REQUIRED');r.source='Clay export - supplied by OWNER; imported '+new Date(a.now).toISOString();r.emailStatus='not_collected';return r;});
  return{mode:b.mode,batchId:b.batchId,rows};
 }
 if(action==='sheet'){
  const sheets=unwrap(a.response).sheets;must(Array.isArray(sheets),'CRM_SHEETS_METADATA_REQUIRED');const candidates=sheets.map(s=>s.properties).filter(s=>s&&!s.hidden&&(!s.sheetType||s.sheetType==='GRID')&&(!a.sheetTitle||s.title===a.sheetTitle));must(candidates.length===1,'CRM_TAB_SELECTION_REQUIRED');const p=candidates[0];must(p.gridProperties?.rowCount<=20000&&p.gridProperties?.columnCount<=100,'CRM_GRID_TOO_LARGE_FOR_SMALL_CANARY');return{sheetTitle:p.title,range:"'"+p.title.replaceAll("'","''")+"'!A1:CV20000"};
 }
 if(action==='plan'){
  if(a.request.mode==='inspect'){
   const values=unwrap(a.response).values||[];must(Array.isArray(values),'CRM_ROWS_INVALID');
   const headers=Array.isArray(values[0])?values[0].map(normal):[],missingFields=[],ambiguousFields=[],map={};
   for(const f of fields){const indices=headers.flatMap((v,i)=>aliases[f].includes(v)?[i]:[]);if(!indices.length)missingFields.push(f);else if(indices.length>1)ambiguousFields.push(f);else map[f]=indices[0];}
   const existing=values.slice(1).filter(r=>Array.isArray(r)&&r.some(v=>text(v,1000))),seen=new Set();let legacyRows=0,duplicateIds=0;
   for(const cells of existing){const id=map.sbKey===undefined?'':text(cells[map.sbKey],1000);if(!id)legacyRows++;else if(seen.has(id))duplicateIds++;else seen.add(id);}
   return{mode:'inspect',batchId:a.request.batchId,existingRows:existing.length,missingFields,ambiguousFields,legacyRows,duplicateIds,emailColumnPresent:headers.some(v=>['email','workemail','businessemail','adressemail','adresemail'].includes(v)),canarySchemaReady:missingFields.length===0&&ambiguousFields.length===0&&legacyRows===0&&duplicateIds===0,canWrite:false};
  }
  const values=unwrap(a.response).values||[],map=mapHeaders(values),seen=new Map(),incoming=new Map(),append=[],expected=[];let duplicates=0;
  for(const cells of values.slice(1)){if(!cells.some(v=>text(v,1000)))continue;const r={};for(const f of fields)r[f]=text(cells[map[f]],1000);must(r.sbKey,'CRM_LEGACY_IDENTITY_REQUIRES_REVIEW');must(!seen.has(r.sbKey),'CRM_EXISTING_DUPLICATE_ID_REQUIRES_REVIEW');seen.set(r.sbKey,r);}
  for(const r of a.request.rows){if(incoming.has(r.sbKey)){must(same(incoming.get(r.sbKey),r),'CANARY_BATCH_IDENTITY_CONFLICT');duplicates++;continue;}incoming.set(r.sbKey,r);const old=seen.get(r.sbKey);if(old){must(same(old,r),'CRM_IDENTITY_DATA_CONFLICT_REQUIRES_REVIEW');duplicates++;}else{const cells=Array(values[0].length).fill('');for(const f of fields)cells[map[f]]=r[f];append.push(cells);}expected.push({...r,existed:!!old});}
  must(values.length+append.length<=20000,'CRM_RANGE_LIMIT_CANARY_APPEND_BLOCKED');
  return{mode:a.request.mode,batchId:a.request.batchId,appendBody:{majorDimension:'ROWS',values:append},expected,duplicates,newRows:append.length,sourceRows:a.request.rows.length,canWrite:a.request.mode==='append'&&append.length>0};
 }
 if(action==='verify'){
  const values=unwrap(a.response).values||[],map=mapHeaders(values);let confirmed=0;
  for(const r of a.plan.expected){const matches=values.slice(1).filter(v=>text(v[map.sbKey],1000)===r.sbKey);must(matches.length<=1,'CRM_DUPLICATE_ID_AFTER_WRITE');if(matches.length===1){for(const f of ['company','country','industry','fullName','title','website','personLinkedIn'])must(r.existed?comparable(matches[0][map[f]])===comparable(r[f]):text(matches[0][map[f]],1000)===r[f],'CRM_READBACK_FIELDS_DIFFER');confirmed++;}}
  must(confirmed===a.plan.expected.length,'CRM_WRITE_NOT_CONFIRMED_NO_AUTOMATIC_RETRY');
  return{status:a.plan.mode==='preview'?'PREVIEW_ONLY':a.plan.mode==='verify'?'READBACK_CONFIRMED':'CANARY_CRM_READBACK_CONFIRMED',batchId:a.plan.batchId,sourceRows:a.plan.sourceRows,rowsAppended:a.plan.mode==='append'?a.plan.newRows:0,duplicateRows:a.plan.duplicates,confirmedUniqueRows:confirmed,emailAddressesCollected:0,phoneNumbersCollected:0,clayApiCalls:0,dataCreditsUsedByBridge:0,clayDiscoveryActionUsage:'NOT_MEASURED_BY_BRIDGE',sourcingScheduled:false};
 }
 if(action==='preview'){
  if(a.plan.mode==='inspect')return{...a.plan,status:'CRM_READ_CONFIRMED',crmWrites:0,clayApiCalls:0,dataCreditsUsedByBridge:0,emailWritingSupported:false,sourcingScheduled:false};
  return{status:'PREVIEW_ONLY',batchId:a.plan.batchId,sourceRows:a.plan.sourceRows,rowsToAppend:a.plan.newRows,duplicateRows:a.plan.duplicates,crmWrites:0,clayApiCalls:0,sourcingScheduled:false};
 }
 if(action==='appendAck'){must(a.response?.statusCode===200&&a.response?.body?.updates?.updatedRows===a.plan.newRows,'CRM_APPEND_ACK_NOT_CONFIRMED_NO_AUTOMATIC_RETRY');return{acknowledged:true};}
 must(false,'CANARY_STAGE_INVALID');
}
