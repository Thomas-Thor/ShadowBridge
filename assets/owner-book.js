/* Private operational memory. No local/session storage, HTML injection, secret
   vault access or external transmission. All actions use the existing BFF. */
(() => {
 'use strict';
 const base='/api/owner/book',states=new Set(),views={tasks:'task',notes:'note',ideas:'idea',calendar:'event',decisions:'decision'};
 const labels={task:'Task',note:'Note',idea:'Idea',event:'Event',decision:'Decision'};
 const ui=()=>window.ShadowDashboard,el=(...args)=>ui().create(...args),link=(name,view='overview',id)=>el('a',{class:'dashboard-inline-link',href:'/portal/admin/?'+new URLSearchParams({module:'book',view,...(id?{id}:{})})+'#owner-command-book',text:name});
 const when=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Not set';
 const local=v=>{if(!v)return'';const d=new Date(v);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const iso=v=>v?new Date(v).toISOString():null;
 function keyExpiry(period,custom,now=Date.now()){
  const days=['1','3','7','30','60'];let end;
  if(period==='custom'){
   if(typeof custom!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(custom))throw Error('Choose a valid custom expiry date and time.');
   end=new Date(custom);if(!Number.isFinite(end.getTime())||local(end.toISOString())!==custom)throw Error('This local time does not exist. Choose a different expiry.');
  }else{if(!days.includes(period))throw Error('Choose one of the permitted expiry periods.');end=new Date(now+Number(period)*86400000);}
  if(end.getTime()<=now||end.getTime()>now+90*86400000)throw Error('Expiry must be in the future, within 90 days. Existing keys are never extended.');
  return end.toISOString();
 }
 function startSummaryDownload(summary,{doc=document,urlApi=URL,BlobType=Blob,schedule=setTimeout,remember=()=>{}}={}){
  if(typeof summary!=='string'||!summary||summary.length>1024*1024)throw Error('The summary is empty or too large. Select fewer records, then try again.');
  let url,anchor,finished=false;
  const cleanup=()=>{if(finished)return;finished=true;anchor?.remove();if(url)urlApi.revokeObjectURL(url);};
  try{
   if(!doc.body||typeof urlApi.createObjectURL!=='function')throw Error('Download is unavailable.');
   url=urlApi.createObjectURL(new BlobType([summary],{type:'text/plain;charset=utf-8'}));
   anchor=doc.createElement('a');anchor.href=url;anchor.download='ShadowBridge-owner-summary.txt';anchor.hidden=true;anchor.rel='noopener';doc.body.append(anchor);
   // Firefox requires an attached link in several download contexts. Keep the
   // Blob alive long enough for both Gecko and Chromium to consume the file.
   anchor.click();remember(cleanup);schedule(cleanup,60000);return cleanup;
  }catch{cleanup();throw Error('The TXT download could not start. Check browser download permissions or use Copy reviewed summary.');}
 }
 function referenceHint(holder,name){const input=holder.querySelector('[name='+name+']');if(!input)return;const id=input.id+'-reference-help';input.setAttribute('aria-describedby',id);input.closest('label').append(el('small',{id,class:'book-reference-help',text:'Optional. Reference a source, previous agreement or related material.'}));}
 const osloDay=v=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
 const midnight=date=>{const d=new Date(date+'T00:00:00Z'),zone=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',timeZoneName:'longOffset'}).formatToParts(d).find(p=>p.type==='timeZoneName').value;return new Date(date+'T00:00:00'+zone.replace('GMT','')).toISOString();};
 const addDay=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const state=host=>{const s={host,closed:false,version:0,secrets:[],timers:[],clear(){s.closed=true;s.version++;s.secrets.forEach(fn=>fn());s.timers.forEach(clearTimeout);host.replaceChildren();host.remove();states.delete(s);}};states.add(s);return s;};
 const live=s=>!s.closed&&s.host.isConnected;
 const alert=(host,title,message,tone='warning')=>host.append(ui().alert({title,message,tone}));
 const fields=kind=>[
  ['title',labels[kind]+' title','text',true],['body',kind==='decision'?'Decision and rationale':'Operational details (no passwords or infrastructure keys)','textarea'],
  ['priority','Priority','select',true,['low','normal','high','critical']],['status','Status','select',true,['planned','open','in_progress','blocked','done','cancelled','recorded']],
  ...(kind==='event'?[['starts_at','Starts','datetime-local',true],['ends_at','Ends','datetime-local']]:[['due_at','Due','datetime-local']]),
  ['remind_at','In-app reminder','datetime-local'],['source_ref','Reference / Source (optional)','text'],['archived','Move to archive','checkbox']
 ];
 function validatePage(r){if(!r||!Array.isArray(r.items)||!Number.isSafeInteger(r.total)||r.total<0||r.items.length>25)throw Error('Invalid private response.');return r;}
 async function overview({host,api,access}){
  if(access?.owner!==true)return;const frame=el('section',{class:'dashboard-card book-entry-point'});host.append(frame);const s=state(frame);
  frame.append(ui().sectionHeader({title:'OWNER Command Book',description:'Private tasks, ideas, calendar and decisions.'}),link('Open private command book'));
  try{const r=await api(base+'/summary');if(live(s))frame.append(el('p',{text:`${r.counts.task} tasks · ${r.counts.idea} ideas · ${r.counts.event} events. ${r.reminders.length} due reminders shown. Europe/Oslo.`}));}catch(e){if(live(s))alert(frame,'Command Book unavailable',e.message,'error');}
 }
 function mount({host,api,access,form,ownerReconfirmation}){
  if(access?.owner!==true)return;
  const frame=el('section',{id:'owner-command-book',tabindex:'-1',class:'portal-section dashboard-stack book-workspace','data-owner-book':'','aria-label':'OWNER Command Book'});host.append(frame);const s=state(frame),params=new URLSearchParams(location.search),view=params.get('view')||'overview';
  frame.append(ui().sectionHeader({title:'OWNER Command Book',eyebrow:'PRIVATE OPERATIONAL MEMORY',description:'Your decisions, next actions and working context. OWNER + MFA. Separate from the private business CRM and password manager.'}));
  const nav=el('nav',{class:'book-tabs','aria-label':'Command Book sections'});
  for(const [key,title]of [['overview','Overview'],['tasks','Tasks'],['notes','Notebook'],['ideas','Ideas'],['calendar','Calendar'],['decisions','Decisions'],['journal','Activity journal'],['keys','API access'],['transfer','Import / export'],['secure','Secure vault']])nav.append(el('a',{href:'/portal/admin/?'+new URLSearchParams({module:'book',view:key})+'#owner-command-book',text:title,'aria-current':view===key?'page':null}));frame.append(nav);
  const security=el('details',{class:'book-security'},[el('summary',{text:'Confirm OWNER MFA for sensitive actions'}),el('p',{text:'Key management, imports, exports and decisions require a recent authenticator confirmation.'})]);ownerReconfirmation(security);frame.append(security);
  const content=el('div',{class:'dashboard-stack'});frame.append(content);
  const run=async fn=>{try{await fn();}catch(e){if(live(s))alert(content,'Action not completed',e.message,'error');}};
  const btn=(text,fn,secondary=true)=>{const b=el('button',{type:'button',class:'portal-button'+(secondary?' portal-button-secondary':''),text});b.addEventListener('click',()=>{b.disabled=true;run(fn).finally(()=>{if(b.isConnected)b.disabled=false;});});return b;};
  const card=item=>el('article',{class:'dashboard-card book-record'},[el('div',{class:'book-record-heading'},[el('h3',{},[link(item.title,Object.keys(views).find(v=>views[v]===item.kind),item.id)]),ui().statusBadge(item.status,item.status.replaceAll('_',' '))]),el('p',{class:'book-record-meta',text:`${labels[item.kind]} · ${item.priority} priority · ${item.source_label}`}),el('p',{class:'book-record-body',text:item.body}),el('p',{class:'book-record-meta',text:item.kind==='event'?`Starts ${when(item.starts_at)}`:item.due_at?`Due ${when(item.due_at)}`:`Updated ${when(item.updated_at)}`})]);
  const entryForm=(holder,kind,item,after)=>{
   const command=crypto.randomUUID(),values=item?{...item,...Object.fromEntries(['due_at','starts_at','ends_at','remind_at'].map(k=>[k,local(item[k])]))}:{priority:'normal',status:kind==='event'?'planned':kind==='decision'?'recorded':'open'};
   const chosen=new Set(item?.dependencies||[]);
   const f=form(holder,fields(kind),item?'Save private change':'Create '+labels[kind].toLowerCase(),async data=>{
    const entry={...data,kind,dependencies:[...chosen]};for(const k of ['due_at','starts_at','ends_at','remind_at'])if(Object.hasOwn(entry,k))entry[k]=iso(entry[k]);
    if(item)entry.version=item.version;
    await api(base+'/entries'+(item?'/'+item.id:''),item?'PUT':'POST',{entry,requestKey:command});if(live(s))await after();return false;
   },values);f.autocomplete='off';f.dataset.preserveValues='true';f.querySelector('[name=title]').maxLength=200;f.querySelector('[name=source_ref]').maxLength=500;referenceHint(f,'source_ref');
   holder.append(el('p',{class:'book-record-meta',text:`Editor dates use ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Calendar and saved times are displayed in Europe/Oslo. Reminders appear in this workspace; no email or push delivery is configured.`}));
   if(kind==='task'){
    const box=el('fieldset',{class:'book-dependencies'},[el('legend',{text:'Prerequisite tasks'}),el('p',{text:'Only your own tasks. Cycles and completion before prerequisites are rejected by the database.'})]);f.querySelector('fieldset').append(box);
    api(base+'/entries?kind=task').then(async r=>{
     if(!live(s)||!box.isConnected)return;const choices=validatePage(r).items.filter(x=>x.id!==item?.id);
     for(const id of chosen)if(!choices.some(x=>x.id===id)){const extra=await api(base+'/entries/'+id+'?kind=task');if(live(s))choices.push(extra);}
     if(!live(s)||!box.isConnected)return;
     for(const task of choices){const input=el('input',{type:'checkbox'});input.checked=chosen.has(task.id);input.addEventListener('change',()=>input.checked?chosen.add(task.id):chosen.delete(task.id));box.append(el('label',{class:'entry-check'},[input,document.createTextNode(task.title)]));}
     if(r.total>25)box.append(el('p',{text:'Showing the first 25 tasks and existing dependencies. Narrow the task list before creating additional links.'}));
    }).catch(e=>{if(live(s))alert(box,'Dependencies unavailable',e.message,'error');});
   }
   return f;
  };
  async function showOverview(){
   const r=await api(base+'/summary');if(!live(s))return;content.replaceChildren();const grid=el('div',{class:'dashboard-grid book-kpis'});
   for(const [key,title]of Object.entries(labels))grid.append(ui().metric({label:title+' records',value:r.counts[key],detail:'Unarchived private records.',href:'/portal/admin/?module=book&view='+Object.keys(views).find(v=>views[v]===key),linkLabel:'Open workspace'}));content.append(grid);
   const split=el('div',{class:'dashboard-split'}),capture=el('section',{class:'dashboard-card'},[ui().sectionHeader({title:'Quick capture',description:'Save an idea or operational note without leaving your workspace.'})]);
   const captureCommand=crypto.randomUUID();form(capture,[['kind','Record as','select',true,[{value:'idea',label:'Idea'},{value:'note',label:'Operational note'},{value:'task',label:'Task'}]],['title','Title','text',true],['body','Context (no passwords)','textarea']],'Save privately',async data=>{await api(base+'/entries','POST',{entry:{...data,priority:'normal',status:'open'},requestKey:captureCommand});if(live(s))await showOverview();return false;},{kind:'idea'});
   const reminders=el('section',{class:'dashboard-card'},[ui().sectionHeader({title:'Due reminders',description:'In-app reminders. Up to 10 overdue or due records; no outbound messages are sent.'})]);
   if(!r.reminders.length)reminders.append(el('p',{class:'portal-empty',text:'No due reminders.'}));for(const e of r.reminders)reminders.append(card(e));split.append(capture,reminders);content.append(split);
  }
  async function showEntries(kind){
   const id=params.get('id');if(id){await showDetail(kind,id);return;}
   content.replaceChildren();let page=1,filter={q:'',status:'',archived:'false'},month=osloDay(new Date()).slice(0,7),day='';
   const create=el('details',{class:'book-editor'},[el('summary',{text:'New '+labels[kind].toLowerCase()})]);content.append(create);entryForm(create,kind,null,()=>showEntries(kind));
   const filters=el('div',{class:'dashboard-card'});content.append(filters);const controls=form(filters,[['q','Search your records','search'],['status','Status','select',false,['planned','open','in_progress','blocked','done','cancelled','recorded']],['archived','Archive','select',true,[{value:'false',label:'Active records'},{value:'true',label:'Archived records'},{value:'all',label:'All records'}]]],'Apply filters',async data=>{filter=data;page=1;await load();return false;},filter);controls.dataset.preserveValues='true';
   let calendar;if(kind==='event'){
    const toolbar=el('div',{class:'book-calendar-toolbar'},[el('label',{for:'book-month',text:'Calendar month · Europe/Oslo'})]),picker=el('input',{id:'book-month',type:'month',value:month});toolbar.append(picker,btn('Show full month',async()=>{day='';page=1;await load();}));content.append(toolbar);calendar=el('div',{class:'book-calendar','aria-label':'Monthly events'});content.append(calendar);
    picker.addEventListener('change',()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(picker.value)){month=picker.value;day='';page=1;run(load);}});
   }
   const output=el('p',{role:'status','aria-live':'polite'}),list=el('div',{class:'book-records'}),pager=el('nav',{class:'book-pagination','aria-label':'Private record pages'});content.append(output,list,pager);
   async function load(){
    const seq=++s.version;const p=new URLSearchParams({...filter,kind,page:String(page)});
    if(kind==='event'){
     const [y,m]=month.split('-').map(Number),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);p.set('from',midnight(day||month+'-01'));p.set('until',midnight(day?addDay(day,1):next));
    }
    const r=validatePage(await api(base+'/entries?'+p));if(!live(s)||seq!==s.version)return;
    output.textContent=`${r.total} matching records${day?' on '+day:''}. Page ${page}.`;list.replaceChildren(...r.items.map(card));if(!r.items.length)list.append(el('p',{class:'portal-empty',text:'No matching private records.'}));
    pager.replaceChildren();if(page>1)pager.append(btn('Previous',async()=>{page--;await load();}));if(page*25<r.total)pager.append(btn('Next',async()=>{page++;await load();}));
    if(calendar){
     // A bounded calendar preview, never an unbounded download of the notebook.
     const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(),first=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;calendar.replaceChildren();
     for(const name of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])calendar.append(el('span',{class:'book-weekday',text:name}));for(let i=0;i<first;i++)calendar.append(el('span',{'aria-hidden':'true'}));
     for(let n=1;n<=last;n++){const d=month+'-'+String(n).padStart(2,'0'),events=r.items.filter(e=>osloDay(e.starts_at)===d),cell=el('div',{class:'book-day'+(d===osloDay(new Date())?' book-day-today':'')});cell.append(btn(String(n),async()=>{day=d;page=1;await load();}));for(const e of events.slice(0,2))cell.append(link(e.title,'calendar',e.id));calendar.append(cell);}
     calendar.append(el('p',{class:'book-calendar-note',text:'Calendar labels show events on this result page. The agenda and pagination below contain the full matching result.'}));
    }
   }
   await load();
  }
  async function showDetail(kind,id){
   const item=await api(base+'/entries/'+encodeURIComponent(id)+'?kind='+kind);if(!live(s))return;content.replaceChildren(card(item));content.append(link('Back to '+labels[kind].toLowerCase()+' workspace',Object.keys(views).find(v=>views[v]===kind)));
   const editor=el('section',{class:'dashboard-card book-editor'},[el('h3',{text:'Edit private record'})]);content.append(editor);entryForm(editor,kind,item,()=>showDetail(kind,id));
   const history=el('section',{class:'dashboard-card'},[el('h3',{text:'Change history'})]);content.append(history);history.append(btn('Load recorded changes',async()=>{const r=validatePage(await api(base+'/entries/'+id+'/history?kind='+kind));if(!live(s))return;history.replaceChildren(el('h3',{text:'Change history'}),el('p',{text:`${r.total} changes; showing the most recent 25.`}));for(const h of r.items)history.append(el('details',{},[el('summary',{text:when(h.created_at)+' · '+h.channel}),el('pre',{class:'book-history',text:JSON.stringify({before:h.before_data,after:h.after_data},null,2)})]));}));
  }
  async function showJournal(){
   content.replaceChildren();let windowName='24h',page=1;form(content,[['window','Period','select',true,[{value:'24h',label:'24 hours'},{value:'7d',label:'7 days'},{value:'14d',label:'14 days'},{value:'since_login',label:'Since previous recorded sign-in'}]]],'Load recorded activity',async data=>{windowName=data.window;page=1;await load();return false;},{window:windowName});const holder=el('div',{class:'dashboard-stack'});content.append(holder);
   async function load(){const r=validatePage(await api(base+'/journal?'+new URLSearchParams({window:windowName,page})));if(!live(s))return;holder.replaceChildren();alert(holder,'Monitoring coverage',r.warning);if(r.window.previousLoginFallback)alert(holder,'No previous login recorded','Showing the last 24 hours instead.');
    const grid=el('div',{class:'dashboard-grid'});for(const [k,title]of [['crmContacts','CRM contacts recorded'],['crmCompanies','CRM companies recorded'],['bookChanges','Private book changes'],['tasksMarkedDone','Tasks marked done'],['plannedItems','New planned items']])grid.append(ui().metric({label:title,value:r.counts[k],detail:k==='tasksMarkedDone'?'Completion recorded by OWNER or an authorized API, not independently verified.':'Persisted records in the selected interval.'}));holder.append(grid,el('p',{text:`${when(r.window.from)} to ${when(r.window.until)} · Europe/Oslo. Agent run counts and actual costs are not connected.`}));
    for(const e of r.items)holder.append(el('article',{class:'dashboard-card book-journal-event'},[el('h3',{text:e.action.replaceAll('_',' ')}),el('p',{text:when(e.at)+' · recorded'}),el('code',{text:e.sourceRef})]));if(!r.items.length)holder.append(el('p',{text:'No recorded events in this interval.'}));const pager=el('nav',{class:'book-pagination'});if(page>1)pager.append(btn('Previous',async()=>{page--;await load();}));if(page*25<r.total)pager.append(btn('Next',async()=>{page++;await load();}));holder.append(pager);
   }await load();
  }
  async function showKeys(){
   const r=await api(base+'/keys');if(!live(s))return;content.replaceChildren();alert(content,'Scoped access only','Keys authorize Command Book resources only. They never grant OWNER role, CRM, bank, password manager or infrastructure access. Never paste a key into a chat or repository.');
   if(!s.config.remoteApiEnabled)alert(content,'Remote API disabled','Keys can be prepared, but external API calls remain disabled until a separately approved release configuration.');
   const holder=el('section',{class:'dashboard-card'},[el('h3',{text:'Create an expiring key'})]),selected=new Set(['task.read','note.read','idea.read','event.read','decision.read','journal.read']);content.append(holder);
   const secret=el('div',{'aria-live':'polite'});holder.append(secret);const f=form(holder,[['name','Key name','text',true],['mode','Access mode','select',true,[{value:'read_only',label:'READ ONLY (default)'},{value:'custom',label:'CUSTOM scopes'},{value:'book_admin',label:'Book administrator (no platform security access)'}]],['days','Expires after','select',true,[{value:'1',label:'1 day'},{value:'3',label:'3 days'},{value:'7',label:'7 days'},{value:'30',label:'30 days'},{value:'60',label:'60 days'},{value:'custom',label:'CUSTOM date and time (max 90 days)'}]],['customExpiry','Custom expiry in your device time zone','datetime-local']],'Create scoped key',async data=>{
    const key=await api(base+'/keys','POST',{name:data.name,mode:data.mode,scopes:[...selected],expiresAt:keyExpiry(data.days,data.customExpiry)});if(!live(s))return false;
    secret.replaceChildren();const value=el('input',{type:'password',readonly:true,autocomplete:'off','aria-label':'New API key, shown once'});value.value=key.token;delete key.token;const clear=()=>{value.value='';secret.replaceChildren();};s.secrets.push(clear);s.timers.push(setTimeout(clear,120000));
    const copied=el('p',{role:'status'});secret.append(ui().alert({title:'ONE-TIME SECRET — save securely now',message:'Masked by default. COPY sends it only to your clipboard. Paste only into the integration authentication field, never a chat. Cleared here after two minutes, dismissal or session change; clearing the page does not clear the clipboard.'}),value,btn('COPY API KEY',async()=>{if(!value.value)throw Error('This one-time secret has been cleared.');await navigator.clipboard.writeText(value.value);copied.textContent='Copied. Paste into the secure Authentication field, then dismiss this secret.';},false),btn('Show / hide',()=>{value.type=value.type==='password'?'text':'password';}),btn('Dismiss key',clear),btn('Revoke this new key',async()=>{await api(base+'/keys/'+key.id+'/revoke','POST',{});clear();if(live(s))await showKeys();}),copied);return false;
   },{mode:'read_only',days:'7'});f.dataset.preserveValues='true';
   const choices=el('fieldset',{class:'book-scopes'},[el('legend',{text:'Permitted resources'})]);f.querySelector('fieldset').append(choices);const boxes=[];
   for(const scope of r.scopeCatalog){const b=el('input',{type:'checkbox'});b.checked=selected.has(scope);b.addEventListener('change',()=>b.checked?selected.add(scope):selected.delete(scope));boxes.push([scope,b]);choices.append(el('label',{class:'entry-check'},[b,document.createTextNode(scope)]));}
   const mode=f.querySelector('[name=mode]');const update=()=>{for(const [scope,b]of boxes){b.disabled=mode.value==='book_admin'||mode.value==='read_only'&&!scope.endsWith('.read');if(mode.value==='book_admin'){b.checked=true;selected.add(scope);}else if(b.disabled){b.checked=false;selected.delete(scope);}}};mode.addEventListener('change',update);update();
   const duration=f.querySelector('[name=days]'),custom=f.querySelector('[name=customExpiry]'),expiryHint=el('p',{class:'book-record-meta',role:'status'});holder.append(expiryHint);
   const expiryChanged=()=>{custom.closest('label').hidden=duration.value!=='custom';custom.disabled=duration.value!=='custom';custom.required=duration.value==='custom';custom.min=local(new Date(Date.now()+60000).toISOString());custom.max=local(new Date(Date.now()+90*86400000-60000).toISOString());try{expiryHint.textContent='New key expires '+when(keyExpiry(duration.value,custom.value))+' (Europe/Oslo). Existing keys stay unchanged.';}catch(e){expiryHint.textContent=e.message;}};
   duration.addEventListener('change',expiryChanged);custom.addEventListener('input',expiryChanged);expiryChanged();
   holder.append(btn('Prepare ChatGPT CUSTOM scopes',()=>{f.querySelector('[name=name]').value='ChatGPT Command Book';mode.value='custom';selected.clear();for(const scope of ['task.read','task.write','note.read','note.write','idea.read','idea.write','event.read','event.write','journal.read','summary.export'])selected.add(scope);for(const [scope,b]of boxes)b.checked=selected.has(scope);update();duration.value='1';expiryChanged();}));
   const list=el('div',{class:'book-records'});content.append(list);for(const key of r.items){const c=el('article',{class:'dashboard-card'},[el('h3',{text:key.name}),el('p',{text:key.mode+' · '+(key.revoked_at?'revoked':new Date(key.expires_at)<new Date()?'expired':'active')}),el('p',{class:'book-record-meta',text:'Expires '+when(key.expires_at)+' · last used '+when(key.last_used_at)}),el('p',{class:'book-scope-list',text:key.scopes.join(', ')})]);if(!key.revoked_at)c.append(btn('Revoke immediately',async()=>{await api(base+'/keys/'+key.id+'/revoke','POST',{});if(live(s))await showKeys();}));list.append(c);}
   const audit=el('section',{class:'dashboard-card'},[el('h3',{text:'API access audit'})]);content.append(audit);audit.append(btn('Load latest access events',async()=>{const a=await api(base+'/audit');if(live(s))audit.replaceChildren(el('h3',{text:'Latest access events'}),...a.items.map(x=>el('p',{text:when(x.created_at)+' · '+x.action+' · '+x.outcome})));}));
  }
  async function showTransfer(){
   content.replaceChildren();alert(content,'Review before importing or sharing','Import creates new private records and never overwrites existing entries. No passwords, access keys or bank credentials belong here. Exports contain selected book records only, never password vault or CRM data.');
   const preview=el('section',{class:'dashboard-card'});const f=form(content,[['format','Import format','select',true,[{value:'text',label:'Plain text as one private note'},{value:'json',label:'JSON array of new book entries'}]],['sourceRef','Reference / Source (optional)','text'],['content','Previous agreements (max 5,000 characters per record)','textarea',true]],'Preview import',async data=>{
    const r=await api(base+'/import/preview','POST',data);if(!live(s))return false;const key=crypto.randomUUID();preview.replaceChildren(el('h3',{text:`Review ${r.items.length} new entries`}));for(const e of r.items)preview.append(el('article',{},[el('h4',{text:labels[e.kind]+': '+e.title}),el('p',{class:'book-record-body',text:e.body})]));preview.append(btn('Confirm import of these entries',async()=>{await api(base+'/import','POST',{items:r.items,requestKey:key,confirm:true});if(live(s))preview.replaceChildren(el('p',{role:'status',text:'Imported into your private book. No earlier record was overwritten.'}));},false));return false;
   },{format:'text'});f.querySelector('[name=content]').maxLength=50000;referenceHint(f,'sourceRef');content.append(preview);
   const output=el('section',{class:'dashboard-card'});content.append(output);form(output,[['resource','Summary selection','select',true,[{value:'task,note,idea,event,decision',label:'All active book resources'},...Object.entries(labels).map(([value,label])=>({value,label}))]]],'Preview summary for a new chat',async data=>{
    const r=await api(base+'/export?kinds='+encodeURIComponent(data.resource));if(!live(s))return false;
    const lines=['# ShadowBridge OWNER operational context','Exported '+r.exportedAt,r.notice];for(const item of r.items)lines.push(`\n## ${labels[item.kind]}: ${item.title}`,`Status: ${item.status}; priority: ${item.priority}; source: ${item.source_label}`,item.body,item.due_at?'Due: '+item.due_at:'',item.starts_at?'Starts: '+item.starts_at:'',item.source_ref?'Reference: '+item.source_ref:'');if(r.truncated)lines.push('\nLimited to the first 50 records. Select fewer resources for the remaining records.');
    const summary=lines.join('\n').replace(/[\u2013\u2014]/g,'-'),pre=el('pre',{class:'book-export',text:summary}),actions=el('div',{class:'book-actions'}),downloadStatus=el('p',{role:'status'});actions.append(btn('Copy reviewed summary',async()=>navigator.clipboard.writeText(summary)),btn('Download summary',()=>{startSummaryDownload(summary,{remember:fn=>s.secrets.push(fn),schedule:(fn,ms)=>s.timers.push(setTimeout(fn,ms))});downloadStatus.textContent='TXT download requested. Check your browser Downloads; if blocked, use Copy reviewed summary.';}));output.querySelector('[data-export-preview]')?.remove();output.append(el('div',{'data-export-preview':''},[el('p',{text:'Review this text before sharing it in a new chat. No transfer has happened.'}),pre,actions,downloadStatus]));return false;
   },{resource:'task,note,idea,event,decision'});
  }
  function showSecure(){
   content.replaceChildren(el('section',{class:'dashboard-card book-secure'},[ui().sectionHeader({title:'OWNER Secure Vault',description:'Open a dedicated password manager. ShadowBridge does not store, unlock, import or transmit your password vault.'}),el('a',{class:'portal-button',href:s.config.passwordManager.url,target:'_blank',rel:'noopener noreferrer',text:'Open Bitwarden EU (external)'}),el('p',{text:'This is a safe launch point, not a connected vault or single sign-on. Sign in with the password manager’s own account and MFA. Use the correct account region.'}),el('ul',{},[el('li',{text:'Keep the master password, MFA recovery code and recovery instructions offline, separately from this server.'}),el('li',{text:'Use encrypted vault exports and test recovery within the password manager. Do not upload exports here.'}),el('li',{text:'A portal API key or assistant has no password-manager scope.'}),el('li',{text:'Bank and infrastructure master credentials belong in the password manager, not operational notes.'})]),el('p',{class:'portal-document-notice',text:'Financial overview: no bank connection exists. Any future integration must be separately approved and read only.'})]));
  }
  run(async()=>{s.config=await api(base+'/config');if(!live(s))return;if(view==='overview')await showOverview();else if(views[view])await showEntries(views[view]);else if(view==='journal')await showJournal();else if(view==='keys')await showKeys();else if(view==='transfer')await showTransfer();else if(view==='secure')showSecure();else alert(content,'Unknown workspace','Choose a Command Book section.');if(live(s)&&location.hash==='#owner-command-book'){frame.scrollIntoView({block:'start',behavior:'instant'});nav.querySelector('[aria-current=page]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}});
 }
 window.ShadowOwnerBook=Object.freeze({overview,mount,keyExpiry,startSummaryDownload,clearPrivate(){for(const s of [...states])s.clear();}});
})();
