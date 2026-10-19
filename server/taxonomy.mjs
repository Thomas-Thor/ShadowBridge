import { ApiError, object, text } from './validation.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function categoryId(value, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ApiError(400,'INVALID_CATEGORY','Choose a valid category.');
  return value.toLowerCase();
}
function categoryInput(input, creating) {
  object(input,creating?['key','label','parentId','active','position']:['label','active','position'],creating?['key','label']:[]);
  if (!creating && !Object.keys(input).length) throw new ApiError(400,'INVALID_FIELDS','Choose a classification change.');
  const result = {};
  if (creating) {
    result.key=text(input.key,'category key',{min:2,max:80});
    if (!/^[a-z][a-z0-9-]+$/.test(result.key)) throw new ApiError(400,'INVALID_CATEGORY','Use a lowercase category key.');
    result.parentId=categoryId(input.parentId,{optional:true});
  }
  if (creating || Object.hasOwn(input,'label')) result.label=text(input.label,'category label',{min:2,max:100});
  if (Object.hasOwn(input,'active')) {
    if(typeof input.active!=='boolean') throw new ApiError(400,'INVALID_CATEGORY','Active must be true or false.');
    result.active=input.active;
  } else if(creating)result.active=true;
  if (Object.hasOwn(input,'position')) {
    if(!Number.isInteger(input.position)||input.position<0||input.position>10000) throw new ApiError(400,'INVALID_CATEGORY','Invalid category position.');
    result.position=input.position;
  } else if(creating)result.position=0;
  return result;
}

// The caller supplies the restricted API database connection, with verified
// asUser/AAL claims for staff routes. The database independently enforces RBAC.
export async function routeTaxonomy({req,url,tx,body}) {
  const route=url.pathname,method=req.method;
  if(method==='GET'&&route==='/api/catalog') {
    return {status:200,data:(await tx.query('SELECT sb.catalog(false) AS catalog')).rows[0].catalog};
  }
  if(method==='GET'&&route==='/api/staff/categories') {
    return {status:200,data:(await tx.query('SELECT sb.catalog(true) AS catalog')).rows[0].catalog};
  }
  if(method==='POST'&&route==='/api/staff/categories') {
    const input=categoryInput(await body(req),true);
    return {status:201,data:{item:(await tx.query('SELECT sb.create_category($1,$2,$3::uuid,$4,$5) AS item',[input.key,input.label,input.parentId,input.active,input.position])).rows[0].item}};
  }
  const match=route.match(/^\/api\/staff\/categories\/([A-Fa-f0-9-]+)$/);
  if(method==='POST'&&match) {
    const id=categoryId(match[1]),input=categoryInput(await body(req),false);
    return {status:200,data:{item:(await tx.query('SELECT sb.update_category($1::uuid,$2::jsonb) AS item',[id,JSON.stringify(input)])).rows[0].item}};
  }
  return null;
}
