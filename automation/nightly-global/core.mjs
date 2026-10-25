// Pure normalization/request logic embedded in native n8n Set expressions.
// No eval, network, credentials, AI, owner sessions, or source records in Git.
export function acquisition(action, a) {
  const fail=m=>{throw new Error('ACQUISITION: '+m);};
  const clean=(v,n=500)=>typeof v==='string'?v.trim().replace(/[\u2013\u2014]/g,'-').slice(0,n):null;
  const get=(v,p)=>{if(!Array.isArray(p)||p.length>8||p.some(k=>typeof k!=='string'||!k||['__proto__','constructor','prototype'].includes(k)))fail('Invalid mapping path');for(const k of p)v=v?.[k];return v;};
  const url=v=>{const s=clean(v,1000);return s&&/^https?:\/\/[^\s/@?#]+(?:\/[^\s?#]*)?$/i.test(s)?s:null;};
  const hosts={apollo:/^api\.apollo\.io$/,clay:/^(?:[a-z0-9-]+\.)?clay\.com$/,relevance:/^(?:api-[a-z0-9]+\.stack\.tryrelevance\.com|api\.relevanceai\.com)$/};
  const validEndpoint=(s)=>{const v=/^https:\/\/([^/?#:@]+)(\/[^\s#]*)?$/.exec(s.endpoint||'');return !!v&&!!hosts[s.provider]?.test(v[1])&&!/@|[\r\n]/.test(s.endpoint)&&!/(trigger|enrich|execute|run-agent|reveal|campaign|sequence|whatsapp|send|outreach|\/run(?:[/?]|$))/i.test(v[2]||'');};
  if(action==='request'){
    const j=a.job,s=j?.source;
    if(!j?.lease||!s?.approved||s.contractVerified!==true||s.action!=='read_stored_or_search_results'||!validEndpoint(s)||!['GET','POST'].includes(s.method))fail('Unapproved source/read contract');
    if(!Number.isFinite(s.maxCreditsPerRequest)||s.maxCreditsPerRequest<0)fail('Unknown credit cost');
    if(Object.keys(s.mapping||{}).some(k=>/phone|mobile|telephone/i.test(k)))fail('Phone collection is not permitted');
    if(!Array.isArray(s.mapping?.rows)||!s.mapping?.companyName||!s.mapping?.companyId)fail('Missing source mapping');
    const body=JSON.parse(JSON.stringify({...s.requestBody,...(s.regionFilters?.[j.region]||{})}));
    const cursor=j.cursor||{page:1};
    const field=s.pagination?.requestField;
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field||''))fail('Invalid pagination field');
    body[field]=s.pagination.mode==='token'?(cursor.token||null):(cursor.page||1);
    const sizeField=s.pagination.sizeField;
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(sizeField||''))fail('Invalid page size field');
    body[sizeField]=Math.min(100,Math.max(1,s.pageSize||100));
    let endpoint=s.endpoint;
    if(s.method==='GET'){
      const parts=[];for(const [k,v]of Object.entries(body)){if(v!==null&&v!==undefined)parts.push(encodeURIComponent(k)+'='+encodeURIComponent(typeof v==='object'?JSON.stringify(v):String(v)));}
      endpoint+=(endpoint.includes('?')?'&':'?')+parts.join('&');
    }
    return {endpoint,method:s.method,body,provider:s.provider,jobId:j.id,lease:j.lease};
  }
  if(action==='page'){
    const j=a.job,s=j.source,r=a.response||{},now=Date.parse(a.now);if(!Number.isFinite(now))fail('Invalid clock');
    const status=Number(r.statusCode||0),headers=r.headers||{};
    if(status!==200){
      const raw=Object.entries(headers).find(([k])=>k.toLowerCase()==='retry-after')?.[1];
      const until=/^\d+$/.test(String(raw||''))?now+Number(raw)*1000:Date.parse(String(raw||''));
      if(Number.isFinite(until)&&until>8640000000000000)fail('Retry-After overflow');
      return {ok:false,status,retryAt:new Date(Math.max(now+900000,Number.isFinite(until)?until:0)).toISOString(),permanent:status>=400&&status<500&&status!==429,records:[]};
    }
    let body=r.body;
    if(typeof body==='string'){if(body.length>2*1024**2)fail('Source response too large');body=JSON.parse(body);}
    const rows=get(body,s.mapping.rows);if(!Array.isArray(rows)||rows.length>100)fail('Unexpected source page');
    const records=[];
    for(const v of rows){
      const m=s.mapping,read=(k,n)=>clean(get(v,m[k]||[]),n);
      const country=read('country',100),countries=s.countryMap||{};
      const iso=/^[A-Z]{2}$/.test(country||'')?country:(countries[country]||null);
      const sourceId=read('companyId',200),name=read('companyName',200);
      if(!sourceId||!name)continue;
      const company={name,country:iso,registrationNumber:read('registrationNumber',100),sector:read('industry',200),category:s.category||null,description:read('description',2000),website:url(read('website',1000)),city:read('city',120)};
      const source={system:s.identityNamespace||s.key,id:sourceId,url:url(read('sourceUrl',1000))||s.endpoint.split('?')[0],acquiredAt:a.now};
      const companyIdentity=company.registrationNumber&&iso?'registry:'+iso+':'+company.registrationNumber:'source:'+source.system+':'+sourceId;
      records.push({type:'company',key:companyIdentity,company,source,status:iso?'unconfirmed':'review_required',globalUniqueness:company.registrationNumber&&iso?'registry':'source_only'});
      if(s.entityType==='contact'){
        const id=read('contactId',200),fullName=read('contactName',200),email=read('email',254),profile=url(read('profile',1000));
        if(!id||!fullName)continue;
        const validEmail=email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),shared=validEmail&&/^(info|sales|office|contact|support|admin)@/i.test(email);
        const individual=validEmail&&!shared&&read('emailKind',12)==='individual';
        const contact={fullName,title:read('title',200),email:validEmail?email:null,emailKind:individual?'individual':shared?'shared':'unknown',professionalUrl:profile};
        const key=profile?'profile:'+profile:individual?'email-company:'+companyIdentity+':'+email.toLowerCase():'source-person:'+source.system+':'+id;
        records.push({type:'contact',key,companyKey:companyIdentity,company,contact,source:{...source,id},status:'unconfirmed'});
      }
      if(s.entityType==='opportunity'){
        const id=read('opportunityId',200),kind=read('opportunityType',20),description=read('opportunityDescription',4000),evidence=url(read('opportunityUrl',1000));
        if(!id||!['BUY','SELL','SURPLUS'].includes(kind)||!description||!evidence)continue;
        records.push({type:'opportunity',key:'lot:'+source.system+':'+id,companyKey:companyIdentity,company,opportunity:{kind,description,url:evidence,quantity:read('quantity',100),currency:read('currency',3),price:read('price',100),publishedAt:read('publishedAt',50),expiresAt:read('expiresAt',50)},source:{...source,id},status:'review_required'});
      }
    }
    const next=s.pagination.mode==='token'?get(body,s.pagination.nextPath||[]):null;
    if(s.pagination.mode==='token'&&next!==null&&next!==undefined&&typeof next!=='string')fail('Invalid next cursor');
    const current=j.cursor?.page||1;
    const pages=s.pagination.totalPagesPath?Number(get(body,s.pagination.totalPagesPath)):null;
    const exhausted=s.pagination.mode==='token'?!next:rows.length<(s.pageSize||100)||(Number.isFinite(pages)&&pages>0&&current>=pages);
    return {ok:true,status,records,nextCursor:s.pagination.mode==='token'?{token:next||null}:{page:current+1},exhausted};
  }
  if(action==='reportText'){
    const r=a.report;
    return ['ShadowBridge OWNER 08:00 - '+r.day,'New companies: '+r.companies,'New contacts: '+r.contacts,'BUY: '+r.BUY+' | SELL: '+r.SELL+' | SURPLUS: '+r.SURPLUS,'New records: '+r.newRecords+' | target: '+r.target,'Duplicates: '+r.duplicates+' | errors: '+r.errors,'CRM delivered: '+r.crmDelivered+' | pending: '+r.crmPending,'Credit upper bound reserved: '+r.creditsReserved+' | actual cost: '+(r.actualCredits===null?'unconfirmed':r.actualCredits),'Blocked sources: '+r.blockedSources].join('\n').replace(/[\u2013\u2014]/g,'-');
  }
  fail('Unknown action');
}
