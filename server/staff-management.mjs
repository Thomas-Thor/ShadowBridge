import { ApiError, object, text, oneOf, number, identifier } from './validation.mjs';
import { currencyCodes } from '../assets/business-config.js';

export const roleCatalog = [
  ['owner','Owner',true],['general_director','General Director / CEO',true],
  ['operations_manager','Operations Manager'],['procurement_manager','Procurement Manager'],
  ['sales_manager','Sales Manager'],['compliance_finance','Compliance / Finance'],['staff_analyst','Staff / Analyst'],
].map(([key,label,ownerOnly=false])=>({key,label,ownerOnly}));

export async function requirePermission(tx, permission) {
  if (!(await tx.query('SELECT sb.has_permission($1) AS allowed',[permission])).rows[0].allowed) throw new ApiError(403,'PERMISSION_REQUIRED',`Permission required: ${permission}.`);
}

export async function routeStaffManagement({req,url,tx,body,user,csrf}) {
  const route=url.pathname, method=req.method;
  if (!route.startsWith('/api/staff/')) return null;
  const result=(status,data)=>({status,data});
  const access=(await tx.query('SELECT sb.staff_context() AS access')).rows[0].access;
  if (method==='GET' && route==='/api/staff/access') {
    const catalog=(await tx.query('SELECT key,owner_controlled AS "ownerControlled" FROM sb.staff_permissions ORDER BY key')).rows;
    return result(200,{...access,user,roleCatalog,permissionCatalog:catalog.map(({key,ownerControlled})=>({key,label:key,ownerControlled})),...csrf()});
  }
  if (method==='GET' && route==='/api/staff/overview') {
    await requirePermission(tx,'overview.read');
    const counts={};
    const counters=[
      ['pendingApplications','applications.read',"SELECT count(*) FROM sb.applications WHERE status='pending'"],
      ['submittedOffers','offers.read',"SELECT count(*) FROM sb.offers WHERE status='submitted'"],
      ['submittedRfqs','rfqs.read',"SELECT count(*) FROM sb.rfqs WHERE status='submitted'"],
      ['activeProjects','projects.read',"SELECT count(*) FROM sb.projects WHERE status IN ('assigned','active','on_hold')"],
      ['pendingProposals','proposals.read',"SELECT count(*) FROM sb.partner_proposals WHERE status='submitted'"],
      ['openContactEnquiries','contact.read',"SELECT count(*) FROM sb.contact_enquiries WHERE status IN ('new','in_review')"],
    ];
    for(const [name,permission,sql] of counters) if(access.permissions.includes(permission)) counts[name]=Number((await tx.query(sql)).rows[0].count);
    counts.pendingRiskApprovals=Number((await tx.query("SELECT count(*) FROM sb.risk_approvals WHERE status='pending' AND expires_at>now()")).rows[0].count);
    const recentActivity=access.permissions.includes('audit.read')?(await tx.query('SELECT action,resource AS "resourceType",created_at AS "createdAt" FROM sb.audit_events ORDER BY id DESC LIMIT 12')).rows:[];
    return result(200,{counts,recentActivity,warnings:counts.pendingRiskApprovals?[`${counts.pendingRiskApprovals} high-risk authorization request(s) require review.`]:[]});
  }
  if(method==='GET' && route==='/api/staff/team') {
    await requirePermission(tx,'staff.read');
    const directory=(await tx.query('SELECT sb.staff_directory() AS directory')).rows[0].directory;
    const items=directory.items.map(item=>({...item,permissions:item.overrides}));
    const eligibleUsers=access.permissions.includes('staff.manage')?(await tx.query('SELECT user_id AS "userId",email FROM sb.accounts WHERE email_verified_at IS NOT NULL AND status=\'active\' ORDER BY email LIMIT 200')).rows:[];
    return result(200,{...directory,items,eligibleUsers});
  }
  if (method==='POST' && route==='/api/staff/roles') {
    await requirePermission(tx,'staff.manage');
    const input=object(await body(req),['userId','role','active','expiresAt'],['userId','role','active']);
    if(typeof input.active!=='boolean')throw new ApiError(400,'INVALID_INPUT','Use an explicit active status.');
    const expiresAt=input.expiresAt?text(input.expiresAt,'role expiry',{max:40}):null;
    if(expiresAt && Number.isNaN(Date.parse(expiresAt)))throw new ApiError(400,'INVALID_INPUT','Invalid role expiry.');
    await tx.query('SELECT sb.set_staff_role($1::uuid,$2,$3,$4::timestamptz)',[identifier(input.userId),oneOf(input.role,roleCatalog.map(x=>x.key),'staff role'),input.active,expiresAt]);
    return result(200,{updated:true});
  }
  if (method==='POST' && route==='/api/staff/permissions') {
    await requirePermission(tx,'staff.manage');
    const input=object(await body(req),['userId','permission','effect'],['userId','permission','effect']);
    await tx.query('SELECT sb.set_staff_permission($1::uuid,$2,$3)',[identifier(input.userId),text(input.permission,'permission',{min:3,max:100}),oneOf(input.effect,['allow','deny','remove'],'effect')]);
    return result(200,{updated:true});
  }
  if (method==='POST' && route==='/api/staff/limits') {
    const input=object(await body(req),['userId','amount','currency'],['userId','amount','currency']);
    const currency=oneOf(input.currency,currencyCodes,'currency');
    await tx.query('SELECT sb.set_staff_limit($1::uuid,$2::numeric,$3)',[identifier(input.userId),number(input.amount,'amount'),currency]);
    return result(200,{updated:true});
  }
  if (method==='POST' && route==='/api/staff/company-members') {
    await requirePermission(tx,'memberships.edit');
    const input=object(await body(req),['companyId','userId','role','status'],['companyId','userId','role','status']);
    const company=identifier(input.companyId),target=identifier(input.userId),role=oneOf(input.role,['buyer','supplier','partner'],'role');
    const status=oneOf(input.status,['approved','revoked'],'membership status');
    if(status==='approved')await tx.query('SELECT sb.add_company_member($1::uuid,$2::uuid,$3)',[company,target,role]);
    else {
      const rows=await tx.query('SELECT id FROM sb.memberships WHERE company_id=$1::uuid AND user_id=$2::uuid AND role=$3',[company,target,role]);
      if(!rows.rowCount)throw new ApiError(404,'NOT_FOUND','Membership not found.');
      await tx.query("SELECT sb.set_membership_status($1::uuid,'suspended')",[rows.rows[0].id]);
    }
    return result(200,{updated:true});
  }
  if(method==='GET' && route==='/api/staff/risk-approvals') {
    return result(200,{items:(await tx.query('SELECT id,action,amount,currency,status,requested_by AS "requestedBy",created_at AS "createdAt",expires_at AS "expiresAt" FROM sb.risk_approvals ORDER BY created_at DESC LIMIT 100')).rows});
  }
  if(method==='POST' && route==='/api/staff/risk-approvals') {
    const input=object(await body(req),['action','projectId','amount','currency','agreementReference','status'],['action','projectId','amount','currency','agreementReference']);
    oneOf(input.action,['commissions.create'],'risk action');await requirePermission(tx,'commissions.create');
    const project=(await tx.query('SELECT id,partner_company_id FROM sb.projects WHERE public_id=$1',[identifier(input.projectId)])).rows[0];
    if(!project)throw new ApiError(404,'NOT_FOUND','Project not found.');
    const currency=oneOf(input.currency,currencyCodes,'currency');
    const reference=text(input.agreementReference,'agreement reference',{min:3,max:80});
    if(!/^[A-Z0-9-]{3,80}$/.test(reference))throw new ApiError(400,'INVALID_INPUT','Use a non-identifying reference code.');
    const payload={projectId:project.id,partnerCompanyId:project.partner_company_id,amount:number(input.amount,'amount'),currency,agreementReference:reference,status:oneOf(input.status||'agreed',['agreed'],'status')};
    const id=(await tx.query('SELECT sb.request_risk_approval($1,$2::jsonb) AS id',[input.action,JSON.stringify(payload)])).rows[0].id;
    return result(201,{id,status:'pending'});
  }
  const decision=route.match(/^\/api\/staff\/risk-approvals\/([A-Za-z0-9-]+)\/decision$/);
  if(method==='POST' && decision) {
    const input=object(await body(req),['decision'],['decision']);
    await tx.query('SELECT sb.decide_risk_approval($1::uuid,$2)',[identifier(decision[1]),oneOf(input.decision,['approved','rejected'],'decision')]);
    return result(200,{updated:true});
  }
  return null;
}
