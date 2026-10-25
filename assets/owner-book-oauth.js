// Only browser session/CSRF here. OAuth and refresh tokens never reach this UI.
(() => {
 const status=document.getElementById('oauth-status'),ticket=document.getElementById('oauth-ticket'),approve=document.getElementById('oauth-approve'),deny=document.getElementById('oauth-deny'),connections=document.getElementById('oauth-connections');let csrf='',busy=false;
 const endpoint='/oauth/owner-book',createConsent=document.getElementById('oauth-create-consent');
 if(createConsent)createConsent.onchange=()=>{approve.disabled=!csrf||!ticket.value||!createConsent.checked;};
 const send=async(path,data)=>{
  const r=await fetch(endpoint+path,{method:data?'POST':'GET',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json',...(data?{'Content-Type':'application/json','X-CSRF-Token':csrf,'X-Session-Token':csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const d=await r.json();if(!r.ok)throw Error(d.code==='FRESH_MFA_REQUIRED'?'Confirm your existing OWNER MFA again, then return here.':r.status===403?'Sign in with an active OWNER and confirm MFA, then return here.':'Unable to complete the private connection. Try again.');return d;
 };
 const check=async()=>{
  approve.disabled=true;csrf='';connections.replaceChildren();
  try{const d=await send('/context');csrf=d.csrfToken;status.textContent=createConsent?'OWNER + fresh MFA confirmed. Temporary additions need separate consent and per-import approval plus verified backup.':'OWNER + fresh MFA confirmed. Review the read-only permissions before allowing access.';approve.disabled=!ticket.value||!!createConsent&&!createConsent.checked;
   for(const c of d.items||[]){const row=document.createElement('p'),label=document.createElement('span');label.textContent=c.name+' · '+c.scopes.join(', ')+' · '+(c.revoked_at?'Revoked':'Expires '+new Date(c.expires_at).toLocaleString())+(c.create_until?' · '+(c.create_revoked_at?'additions withdrawn':'additions until '+new Date(c.create_until).toLocaleString())+' · '+(c.created_records||0)+'/25 created':'');row.append(label);
    if(!c.revoked_at){const button=document.createElement('button');button.type='button';button.textContent='Revoke';button.onclick=async()=>{button.disabled=true;try{await send('/connections/revoke',{id:c.id});await check();}catch(e){status.textContent=e.message;button.disabled=false;}};row.append(' ',button);
     if(c.create_until&&!c.create_revoked_at){const stop=document.createElement('button');stop.type='button';stop.textContent='Withdraw additions; keep read access';stop.onclick=async()=>{stop.disabled=true;try{await send('/connections/revoke-create',{id:c.id});await check();}catch(e){status.textContent=e.message;stop.disabled=false;}};row.append(' ',stop);}
    }connections.append(row);
   }
  }catch(e){status.textContent=e.message;}
 };
 async function consent(allowed){
  if(busy)return;if(!ticket.value){location.assign('/portal/admin/?module=book');return;}busy=true;approve.disabled=true;deny.disabled=true;
  try{const d=await send('/consent',{ticket:ticket.value,approve:allowed,...(createConsent?{temporaryCreateConsent:createConsent.checked}:{})}),target=new URL(d.redirect);
   if(!['https://chatgpt.com/connector_platform_oauth_redirect','https://platform.openai.com/apps-manage/oauth'].includes(target.origin+target.pathname))throw Error('Unexpected callback. Connection stopped.');location.assign(target.href);
  }catch(e){status.textContent=e.message;deny.disabled=false;busy=false;approve.disabled=!csrf;}
 }
 document.getElementById('oauth-check').onclick=check;approve.onclick=()=>consent(true);deny.onclick=()=>consent(false);check();
})();
