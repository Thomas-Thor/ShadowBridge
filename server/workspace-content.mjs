import {ApiError,object,text,oneOf} from './validation.mjs';
export const pages=Object.freeze(['home','member-entry','legal']);
export function blocks(input){
 if(!Array.isArray(input)||input.length>30||Buffer.byteLength(JSON.stringify(input))>100000)throw new ApiError(400,'INVALID_BLOCKS','Use up to 30 content blocks.');
 const ids=new Set();
 return input.map(b=>{
  object(b,['id','type','text','level','href','fileId','alt','align','tone'],['id','type']);
  if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{4,60}$/.test(b.id)||ids.has(b.id))throw new ApiError(400,'INVALID_BLOCK_ID','Use unique block IDs.');ids.add(b.id);
  const type=oneOf(b.type,['heading','paragraph','image','button','divider'],'block type');
  const v={id:b.id,type};
  if(['heading','paragraph','button'].includes(type))v.text=text(b.text,'block text',{min:1,max:8000});
  if(type==='heading')v.level=oneOf(b.level??2,[1,2,3],'heading level');
  if(type==='image'){
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(b.fileId??''))throw new ApiError(400,'INVALID_MEDIA','Choose a public-page image.');
   v.fileId=b.fileId;v.alt=text(b.alt,'image description',{min:1,max:300});
  }
  if(type==='button'){
   v.href=text(b.href,'button link',{min:2,max:300});
   if(!/^\/(?:#[a-zA-Z0-9_-]+|[a-zA-Z0-9/_#-]*)$/.test(v.href)||v.href.startsWith('//')||v.href.includes('..'))throw new ApiError(400,'INVALID_LINK','Use a link to this website.');
  }
  v.align=oneOf(b.align??'left',['left','center','right'],'alignment');v.tone=oneOf(b.tone??'default',['default','accent','muted'],'text tone');return v;
 });
}
export function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function renderBlocks(items){return blocks(items).map(b=>{
 const attrs=`class="site-block site-align-${b.align} site-tone-${b.tone}" data-site-block="${escapeHtml(b.id)}"`;
 if(b.type==='divider')return `<hr ${attrs}>`;
 if(b.type==='image')return `<figure ${attrs}><img loading="lazy" src="/public-media/${b.fileId}" alt="${escapeHtml(b.alt)}"></figure>`;
 if(b.type==='button')return `<p ${attrs}><a class="button button-bronze" href="${escapeHtml(b.href)}">${escapeHtml(b.text)}</a></p>`;
 const tag=b.type==='heading'?'h'+b.level:'p';return `<${tag} ${attrs}>${escapeHtml(b.text).replaceAll('\n','<br>')}</${tag}>`;
}).join('\n');}
export const defaultContent=Object.freeze({
 home:[{id:'home-headline',type:'heading',level:1,text:'Connecting markets.\nCreating possibility.'},{id:'home-intro',type:'paragraph',text:'The right partner can change your business.\nWe help you find them — across markets, industries and borders.'}],
 'member-entry':[{id:'member-headline',type:'heading',level:2,text:'A considered way forward.'},{id:'member-intro',type:'paragraph',text:'One secure entry for buyers, suppliers and B2B partners. Cooperation begins with individual approval.'}],
 legal:[],
});
