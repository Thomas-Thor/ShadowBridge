import {readFile} from 'node:fs/promises';
const boolean=(env,key)=>{
 if(env[key]!==undefined&&!['true','false'].includes(env[key]))throw Error(key+' must be true or false');return env[key]==='true';
};
function endpoint(env,key,local){
 if(!env[key])return null;const u=new URL(env[key]);
 if(u.username||u.password||u.hash||u.search||!['https:','http:'].includes(u.protocol))throw Error('Invalid '+key);
 const allowed=local?['127.0.0.1','localhost']:['media','umami','crm-bridge'];
 if(u.protocol!=='https:'&&!allowed.includes(u.hostname))throw Error(key+' requires HTTPS or the named private service');return u.toString().replace(/\/$/,'');
}
export async function loadWorkspaceConfig(env=process.env){
 const enabled=boolean(env,'COMMAND_CENTER_R2_ENABLED'),local=['local','test'].includes(env.APP_ENV);
 let storageKey=null;
 if(env.WORKSPACE_STORAGE_KEY_FILE){const value=(await readFile(env.WORKSPACE_STORAGE_KEY_FILE,'utf8')).trim();if(!/^[a-f0-9]{64}$/i.test(value))throw Error('WORKSPACE_STORAGE_KEY_FILE must hold one 32-byte hex key');storageKey=Buffer.from(value,'hex');}
 const secretFile=async key=>{if(!env[key])return null;const v=(await readFile(env[key],'utf8')).trim();if(v.length<40||v.length>500||/[\r\n\u0000]/.test(v))throw Error('Invalid '+key);return v;};
 const umamiWebsiteId=env.UMAMI_WEBSITE_ID||null;if(umamiWebsiteId&&!/^[a-f0-9-]{36}$/.test(umamiWebsiteId))throw Error('Invalid UMAMI_WEBSITE_ID');
 const config={enabled,storageKey,mediaUrl:endpoint(env,'MEDIA_SERVICE_URL',local),mediaKey:await secretFile('MEDIA_SHARED_KEY_FILE'),
  crmUrl:endpoint(env,'CRM_BRIDGE_URL',local),crmKey:await secretFile('CRM_BRIDGE_KEY_FILE'),crmWritesEnabled:boolean(env,'CRM_IMPORT_WRITES_ENABLED'),
  umamiUrl:endpoint(env,'UMAMI_INTERNAL_URL',local),umamiWebsiteId,umamiToken:await secretFile('UMAMI_READ_TOKEN_FILE'),
  analyticsEnabled:boolean(env,'PUBLIC_ANALYTICS_ENABLED'),privacyReviewed:boolean(env,'ANALYTICS_PRIVACY_REVIEWED'),secretaryEnabled:boolean(env,'MORNING_BRIEFING_ENABLED')};
 if(enabled&&!storageKey)throw Error('R2 requires WORKSPACE_STORAGE_KEY_FILE and a verified copy of that key in backup');
 if(config.crmWritesEnabled&&(!enabled||!config.crmUrl||!config.crmKey))throw Error('CRM writes require R2 and a configured private CRM bridge');
 if(config.analyticsEnabled&&(!enabled||!config.privacyReviewed||!config.umamiUrl||!umamiWebsiteId))throw Error('Analytics requires R2, a privacy review and configured Umami');
 if(config.secretaryEnabled&&!enabled)throw Error('Briefings require R2');
 return Object.freeze(config);
}
