// Strict graph verification. Only the one documented credential display-label
// rewrite is tolerated. No server updates and no normalization of IDs or code.
import {createHash} from 'node:crypto';
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const graphHash=v=>createHash('sha256').update(JSON.stringify(sorted(v))??'undefined').digest('hex');
const shape=v=>({kind:v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':typeof v,...(typeof v==='string'?{bytes:Buffer.byteLength(v)}:{}),sha256:graphHash(v)});
export function compareCanaryGraph(expected,current){
 const normalized=structuredClone(expected),normalizations=[];
 if(Array.isArray(normalized.nodes)&&Array.isArray(current.nodes))for(let i=0;i<normalized.nodes.length;i++){
  const e=normalized.nodes[i],a=current.nodes[i],ec=e.credentials?.httpHeaderAuth,ac=a?.credentials?.httpHeaderAuth;
  if(e.type==='n8n-nodes-base.webhook'&&a?.type===e.type&&a.id===e.id&&ec?.id&&ac?.id===ec.id&&ec.name==='Private sourcing canary ingress'&&ac.name==='ShadowBridge private Clay intake'){
   ec.name=ac.name;normalizations.push({path:'nodes['+i+'].credentials.httpHeaderAuth.name',kind:'KNOWN_N8N_CREDENTIAL_DISPLAY_LABEL',credentialIdUnchanged:true});
  }
 }
 const actual={name:current.name,nodes:current.nodes,connections:current.connections,settings:Object.fromEntries(Object.keys(expected.settings||{}).map(k=>[k,current.settings?.[k]]))};
 const differences=[];let total=0;
 const add=(path,change,e,a)=>{total++;if(differences.length<80)differences.push({path,change,expected:shape(e),actual:shape(a)});};
 const walk=(e,a,path,depth=0)=>{
  if(graphHash(e)===graphHash(a))return;
  if(depth>32){add(path,'DEPTH_LIMIT',e,a);return;}
  if(Array.isArray(e)&&Array.isArray(a)){if(e.length!==a.length)add(path+'.length','ARRAY_LENGTH',e.length,a.length);for(let i=0;i<Math.max(e.length,a.length);i++)walk(e[i],a[i],path+'['+i+']',depth+1);return;}
  if(e&&a&&typeof e==='object'&&typeof a==='object'&&!Array.isArray(e)&&!Array.isArray(a)){
   for(const k of Object.keys(e))walk(e[k],a[k],path?path+'.'+k:k,depth+1);
   for(const k of Object.keys(a))if(!Object.hasOwn(e,k))add(path+'.[server-added-field]','EXTRA_FIELD',undefined,a[k]);return;
  }
  add(path,'VALUE_CHANGED',e,a);
 };
 walk(normalized,actual,'');
 return{redacted:true,graphMatches:total===0,knownDisplayLabelNormalizations:normalizations,expectedGraphHash:graphHash(expected),comparisonGraphHash:graphHash(normalized),actualComparedGraphHash:graphHash(actual),differenceCount:total,differencesTruncated:total>differences.length,differences,serverWorkflowUpdated:false};
}
