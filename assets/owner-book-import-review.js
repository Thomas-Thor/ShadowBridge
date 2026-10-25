// Review/approval uses the existing browser OWNER session + fresh MFA and CSRF.
// It cannot generate backup receipts or apply/import data.
(() => {
 const status=document.getElementById('import-status'),preview=document.getElementById('import-preview'),confirm=document.getElementById('import-confirm'),approve=document.getElementById('import-approve');
 const base=location.pathname.replace(/\/$/,''),id=base.split('/').pop();if(!/^[a-f0-9-]{36}$/.test(id))return;
 let current;
 const request=async(path,p)=>{const r=await fetch(base+path,{method:p?'POST':'GET',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json',...(p?{'Content-Type':'application/json','X-CSRF-Token':current.csrfToken,'X-Session-Token':current.csrfToken}:{})},...(p?{body:JSON.stringify(p)}:{})});const d=await r.json();if(!r.ok)throw Error('Review unavailable or changed. Confirm existing OWNER MFA and reopen the preview. No import was performed.');return d;};
 confirm.onchange=()=>{approve.disabled=!current||current.phase!=='prepared'||current.diff.conflicts.length>0||!confirm.checked;};
 approve.onclick=async()=>{approve.disabled=true;try{current=await request('/approve',{candidateHash:current.candidate_hash,snapshotHash:current.snapshot_hash,confirm:confirm.checked});status.textContent='Exact preview approved. Next: operator verifies an encrypted backup, then apply the prepared import and read back its IDs. Nothing has been imported by this approval.';}catch(e){status.textContent=e.message;}};
 request('/data').then(d=>{
  current=d;status.textContent=d.diff.missing.length+' missing · '+d.diff.duplicates.length+' existing records preserved · '+d.diff.conflicts.length+' conflicts · '+d.phase+(d.backupVerified?' · backup verified':' · backup not verified');
  for(const item of d.items){const section=document.createElement('section'),h=document.createElement('h2'),text=document.createElement('pre');h.textContent=item.kind+': '+item.title;text.textContent=JSON.stringify(item,null,2);text.className='book-history';section.append(h,text);preview.append(section);}
  const result=document.createElement('pre');result.textContent=JSON.stringify({duplicates:d.diff.duplicates,conflicts:d.diff.conflicts},null,2);result.className='book-history';preview.append(result);confirm.onchange();
 }).catch(e=>{status.textContent=e.message;});
})();
