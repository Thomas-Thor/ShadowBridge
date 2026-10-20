import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { createDatabase } from './db.mjs';
import { createAuthService } from './auth.mjs';
import { assertMailRecipient } from './mail-policy.mjs';
import { requirePermission, routeStaffManagement } from './staff-management.mjs';
import { routeTaxonomy, categoryId } from './taxonomy.mjs';
import { currencyCodes } from '../assets/business-config.js';
import { routeOffersWorkspace } from './offers-workspace.mjs';
import { ApiError, object, text, oneOf, number, list, identifier, profile, businessData, assertNonIdentifyingText } from './validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tables = { offers: { table: 'offers', role: 'supplier', type: 'offer' }, rfqs: { table: 'rfqs', role: 'buyer', type: 'rfq' }, proposals: { table: 'partner_proposals', role: 'partner', type: 'proposal' } };
const rowDTO = row => ({ id: row.public_id, status: row.status,
  data: Object.hasOwn(row,'category_id') ? {...row.data,categoryId:row.category_id,subcategoryId:row.subcategory_id} : row.data,
  ...(Object.hasOwn(row,'classification_review_required')?{classificationReviewRequired:row.classification_review_required}:{}),
  createdAt: row.created_at, updatedAt: row.updated_at });
const companyDTO = row => row ? { name: row.legal_name, registrationNumber: row.registration_number, country: row.country } : null;
function json(res, status, data) { if(res.deferJson){res.stagedJson={status,data};return;} if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Send JSON only.');
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 65536) throw new ApiError(413, 'TOO_LARGE', 'Request too large.'); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON.'); }
}
function headers(res, config) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}
export function createApp({ config = loadConfig(), db = createDatabase({ connectionString: config.databaseUrl, sessionConnectionString: config.sessionDatabaseUrl }) } = {}) {
  const auth = createAuthService({ config, db });
  const attempts = new Map();
  function limit(req, name) {
    const key = `${req.socket.remoteAddress}:${name}`; const now = Date.now();
    const previous = attempts.get(key); const current = previous && now - previous.start < 300000 ? previous : { count: 0, start: now };
    if (++current.count > 40) throw new ApiError(429, 'RATE_LIMITED', 'Please wait before trying again.');
    attempts.set(key, current);
    if (attempts.size > 10000) for (const [id, item] of attempts) if (now - item.start > 300000) attempts.delete(id);
  }
  function intentCookie(res, value, age = 3600) {
    const cookies = res.getHeader('Set-Cookie');
    const cookie = `sb_application_intent=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secureCookies ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [...(Array.isArray(cookies) ? cookies : cookies ? [cookies] : []), cookie]);
  }
  function applicationInput(input) {
    object(input, ['role','company','profile'], ['role','company']);
    const role = oneOf(input.role, ['buyer','supplier','partner'], 'role');
    object(input.company, ['name','registrationNumber','country'], ['name','registrationNumber','country']);
    return { role, company: { legal_name: text(input.company.name, 'company name', {min:2,max:200}), registration_number: text(input.company.registrationNumber, 'registration number', {min:2,max:100}), country: text(input.company.country, 'country', {min:2,max:100}) }, professional: profile(input.profile) };
  }
  async function finishApplication(identity, proposed, onlyIfMissing = false) {
    if (!identity.emailVerified || identity.recoveryOnly) throw new ApiError(403, 'VERIFY_EMAIL', 'Verify your business email first.');
    return db.asUser(identity, {aal:identity.aal}, async tx => {
      const existing = await tx.query('SELECT id FROM sb.applications WHERE user_id=$1', [identity.id]);
      if (existing.rowCount) { if(onlyIfMissing)return; throw new ApiError(409,'APPLICATION_EXISTS','Your application has already been submitted.'); }
      await tx.query('SELECT sb.submit_application($1,$2::jsonb)', [proposed.role, JSON.stringify(proposed.company)]);
      const c = one(await tx.query('SELECT company_id FROM sb.applications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [identity.id]));
      const professional = proposed.professional;
      await tx.query('INSERT INTO sb.professional_profiles(user_id,company_id,countries,sectors,summary) VALUES($1,$2,$3,$4,$5)', [identity.id,c.company_id,professional.countries,professional.sectors,professional.summary]);
    });
  }
  async function consumeIntent(req, res, identity) {
    const token = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('sb_application_intent='))?.slice('sb_application_intent='.length);
    if (!token || !/^[a-f0-9]{64}$/.test(token) || !identity.emailVerified || identity.recoveryOnly) return;
    const hash = createHash('sha256').update(token).digest('hex');
    const intent = (await db.sessionPool.query('SELECT email,payload FROM sb.registration_intents WHERE token_hash=$1 AND expires_at>now()', [hash])).rows[0];
    if (!intent || intent.email.toLowerCase() !== identity.email.toLowerCase()) return;
    await finishApplication(identity, intent.payload, true);
    await db.sessionPool.query('DELETE FROM sb.registration_intents WHERE token_hash=$1', [hash]);
    intentCookie(res, '', 0);
  }
  async function context(identity) {
    if (!identity) return null;
    return db.asUser(identity, { aal: identity.aal }, async tx => {
      const account = (await tx.query('SELECT user_id,email,status,email_verified_at FROM sb.accounts WHERE user_id=$1', [identity.id])).rows[0];
      if (!account) throw new ApiError(403, 'ACCOUNT_UNAVAILABLE', 'Account unavailable.');
      const applications = (await tx.query('SELECT * FROM sb.applications WHERE user_id=$1 ORDER BY created_at DESC', [identity.id])).rows;
      const memberships = (await tx.query('SELECT * FROM sb.memberships WHERE user_id=$1', [identity.id])).rows;
      const companies = (await tx.query("SELECT c.* FROM sb.companies c WHERE c.created_by=$1 OR c.id IN (SELECT company_id FROM sb.memberships WHERE user_id=$1 AND status='approved') ORDER BY CASE WHEN c.id IN (SELECT company_id FROM sb.memberships WHERE user_id=$1 AND status='approved') THEN 0 ELSE 1 END,c.created_at", [identity.id])).rows;
      const staff = (await tx.query('SELECT sb.has_staff_grant() AS staff')).rows[0].staff;
      const roles = account.status === 'active' && identity.emailVerified && !identity.recoveryOnly ? memberships.filter(x => x.status === 'approved').map(x => x.role) : [];
      return { identity, account, applications, memberships, companies, staff, roles };
    });
  }
  function userDTO(ctx) { return ctx ? { id: ctx.identity.id, email: ctx.account.email, emailVerified: ctx.identity.emailVerified, status: ctx.account.status, applicationStatus: ctx.account.status === 'suspended' ? 'suspended' : ctx.applications[0]?.status || 'not_submitted', roles: ctx.roles, staff: ctx.staff, aal: ctx.identity.aal, recoveryOnly: ctx.identity.recoveryOnly, company: companyDTO(ctx.companies[0]) } : null; }
  function needUser(ctx) { if (!ctx) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.'); if (ctx.identity.recoveryOnly) throw new ApiError(403, 'RECOVERY_ONLY', 'Complete password recovery first.'); return ctx; }
  function needRole(ctx, role) { needUser(ctx); if (ctx.account.status !== 'active' || !ctx.roles.includes(role)) throw new ApiError(403, 'APPROVAL_REQUIRED', 'Verified email and management approval for this role are required.'); return ctx.memberships.find(x => x.role === role && x.status === 'approved'); }
  function needStaff(ctx) { needUser(ctx); if (!ctx.staff) throw new ApiError(403, 'ADMIN_REQUIRED', 'Management permission required.'); if (ctx.identity.aal !== 'aal2') throw new ApiError(403, 'MFA_REQUIRED', 'Management actions require MFA.'); }
  const txFor = (ctx, callback) => db.asUser(ctx.identity, { aal: ctx.identity.aal }, callback);
  const one = result => { if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Record not found.'); return result.rows[0]; };
  async function guardReleasedText(tx, values, recipientCompanyId = null) {
    const joined=values.filter(x=>typeof x==='string').join(' ');
    assertNonIdentifyingText(joined);
    const companies=(await tx.query('SELECT id,legal_name,registration_number FROM sb.companies')).rows;
    const lower=joined.toLowerCase();
    for(const company of companies) {
      if(company.id===recipientCompanyId)continue;
      for(const candidate of [company.legal_name,company.registration_number]) {
        if(candidate&&candidate.length>=4&&lower.includes(candidate.toLowerCase()))throw new ApiError(400,'IDENTIFYING_CONTENT','Remove identifying company information from the released text.');
      }
    }
  }
  async function api(req, res, url) {
    const route = url.pathname; const method = req.method;
    if (method === 'GET' && route === '/api/catalog') { const result=await routeTaxonomy({req,url,tx:db.pool,body}); return json(res,result.status,result.data); }
    if (method === 'GET' && route === '/api/config') return json(res, 200, { backendEnabled: true, environment: config.appEnv, ...auth.csrf(req, res) });
    auth.enforceSession(req);
    if (!['GET','HEAD'].includes(method)) auth.enforceCSRF(req);
    if (method === 'POST' && route === '/api/contact') {
      const input = object(await body(req), ['name','email','company','role','message','consent','website'], ['name','email','role','message','consent','website']);
      if (input.consent !== true || input.website !== '') throw new ApiError(400, 'INVALID_CONTACT', 'Confirm the enquiry notice and leave the website field empty.');
      const email = text(input.email, 'email', {min:3,max:254}).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'INVALID_EMAIL', 'Use a valid business email.');
      const enquiry = {
        name: text(input.name, 'name', {min:2,max:120}), email,
        company: text(input.company ?? '', 'company', {max:200}),
        role: oneOf(input.role, ['buyer','supplier','partner','other'], 'role'),
        message: text(input.message, 'message', {min:20,max:5000}),
      };
      // Trust only the actual peer. Forwarded headers cannot reset the intake limit.
      const clientKey = createHmac('sha256', config.sessionEncryptionKey).update(`contact:${req.socket.remoteAddress}`).digest('hex');
      const saved = await db.sessionPool.query('SELECT sb.enqueue_contact($1::jsonb,$2::text) AS receipt', [JSON.stringify(enquiry),clientKey]);
      return json(res,201,{accepted:true,receipt:saved.rows[0].receipt,message:'Your enquiry has been saved to the private ShadowBridge review queue. No email has been sent.'});
    }
    if (method === 'POST' && route === '/api/auth/register') {
      limit(req, 'register'); const input = object(await body(req), ['email','password','role','company','profile'], ['email','password','role','company']);
      const proposed = applicationInput({role:input.role,company:input.company,profile:input.profile});
      const email = text(input.email, 'email', {min:3,max:254}).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'INVALID_EMAIL', 'Use a valid business email.');
      const password = text(input.password, 'password', {min:12,max:128});
      assertMailRecipient(config, email);
      await auth.register({email,password});
      const token=randomBytes(32).toString('hex');
      const hash=createHash('sha256').update(token).digest('hex');
      await db.sessionPool.query('DELETE FROM sb.registration_intents WHERE expires_at<now()');
      await db.sessionPool.query("INSERT INTO sb.registration_intents(token_hash,email,payload,expires_at) VALUES($1,$2,$3::jsonb,now()+interval '1 hour')",[hash,email,JSON.stringify(proposed)]);
      intentCookie(res,token);
      return json(res, 202, {verificationRequired:true, approvalRequired:true, message:'Check your email to verify the account. Private access requires separate management approval.'});
    }
    if (method === 'POST' && route === '/api/auth/login') {
      limit(req, 'login'); const input = object(await body(req), ['email','password'], ['email','password']);
      const identity = await auth.login({email:text(input.email,'email',{min:3,max:254}),password:text(input.password,'password',{min:1,max:128})}, res, req);
      await consumeIntent(req,res,identity);
      return json(res, 200, {user:userDTO(await context(identity)), ...auth.csrf(req,res)});
    }
    if (method === 'POST' && route === '/api/auth/recover') {
      limit(req,'recovery'); const input = object(await body(req), ['email'], ['email']);
      const email=text(input.email,'email',{min:3,max:254}).toLowerCase();
      assertMailRecipient(config, email);
      await auth.requestRecovery({email});
      return json(res,202,{accepted:true,message:'If an eligible account exists, recovery instructions will be sent.'});
    }
    const identity = await auth.authenticate(req);
    if (method === 'GET' && route === '/api/session') return json(res,200,{user:userDTO(await context(identity)),...auth.csrf(req,res)});
    if (method === 'POST' && route === '/api/auth/logout') { await auth.logout(identity,res); return json(res,200,{signedOut:true,...auth.csrf(req,res)}); }
    if (method === 'POST' && route === '/api/auth/password') {
      if(!identity) throw new ApiError(401,'SIGN_IN_REQUIRED','Open the recovery link first.');
      const input=object(await body(req),['password'],['password']);
      return json(res,200,await auth.updatePassword(identity,{password:text(input.password,'password',{min:12,max:128})},res));
    }
    const ctx = needUser(await context(identity));
    if (method === 'GET' && route === '/api/auth/factors') return json(res,200,{factors:await auth.listFactors(identity)});
    if (method === 'POST' && route === '/api/auth/mfa/enroll') { limit(req,'mfa'); return json(res,201,await auth.enrollFactor(identity)); }
    if (method === 'POST' && route === '/api/auth/mfa/verify') {
      limit(req,'mfa'); const input=object(await body(req),['factorId','code'],['factorId','code']);
      const verified=await auth.verifyFactor(identity,{factorId:identifier(input.factorId),code:text(input.code,'MFA code',{min:6,max:6})},res);
      return json(res,200,{user:userDTO(await context(verified)),...auth.csrf(req,res)});
    }
    if(method==='POST' && route==='/api/application') {
      const proposed=applicationInput(await body(req));
      await finishApplication(identity,proposed);
      return json(res,201,{applicationStatus:'pending',approvalRequired:true});
    }
    if (ctx.account.status !== 'active') throw new ApiError(403,'ACCOUNT_SUSPENDED','This account is suspended. Contact ShadowBridge.');
    if(route.startsWith('/api/staff/')) {
      needStaff(ctx);
      return txFor(ctx,async tx=>{
        const routed=await routeOffersWorkspace({req,url,tx,body}) || await routeTaxonomy({req,url,tx,body}) || await routeStaffManagement({req,url,tx,body,user:userDTO(ctx),csrf:()=>auth.csrf(req,res)});
        if(!routed)throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
        return json(res,routed.status,routed.data);
      });
    }
    if (method==='GET' && route==='/api/profile') return txFor(ctx,async tx=>json(res,200,{company:companyDTO(ctx.companies[0]),profile:(await tx.query('SELECT countries,sectors,summary FROM sb.professional_profiles WHERE user_id=$1',[identity.id])).rows[0]||{countries:[],sectors:[],summary:''}}));
    if (method==='PATCH' && route==='/api/profile') {
      needRole(ctx,'partner'); const input=object(await body(req),['profile'],['profile']); const p=profile(input.profile);
      return txFor(ctx,async tx=>{await tx.query('UPDATE sb.professional_profiles SET countries=$1,sectors=$2,summary=$3 WHERE user_id=$4',[p.countries,p.sectors,p.summary,identity.id]);json(res,200,{profile:p});});
    }
    const business = route.match(/^\/api\/(offers|rfqs|proposals)(?:\/([A-Za-z0-9-]+)(?:\/(submit))?)?$/);
    if(business) {
      const [,kind,id,action]=business; const spec=tables[kind]; const membership=needRole(ctx,spec.role); if(id)identifier(id);
      return txFor(ctx,async tx=>{
        if(method==='GET') {
          const result=await tx.query(`SELECT public_id,status,data,created_at,updated_at${kind==='proposals'?'':',category_id,subcategory_id,classification_review_required'} FROM sb.${spec.table} ${id?'WHERE public_id=$1':''} ORDER BY created_at DESC LIMIT 200`,id?[id]:[]);
          return json(res,200,id?{item:rowDTO(one(result))}:{items:result.rows.map(rowDTO)});
        }
        if(method==='POST'&&!id) {
          const input=object(await body(req),['data'],['data']);const data=businessData(kind,input.data);
          const created=one(await tx.query(`INSERT INTO sb.${spec.table}(company_id,created_by,data) VALUES($1,$2,$3::jsonb) RETURNING *`,[membership.company_id,identity.id,JSON.stringify(data)]));
          return json(res,201,{item:rowDTO(created)});
        }
        const current=one(await tx.query(`SELECT * FROM sb.${spec.table} WHERE public_id=$1 FOR UPDATE`,[id]));
        if(!['draft','clarification_requested'].includes(current.status))throw new ApiError(409,'NOT_EDITABLE','Only your draft or clarification record can be edited.');
        if(method==='PATCH'&&!action) {
          const input=object(await body(req),['data'],['data']);const data=businessData(kind,input.data);
          const updated=one(await tx.query(`UPDATE sb.${spec.table} SET data=$1::jsonb,status='draft' WHERE public_id=$2 RETURNING *`,[JSON.stringify(data),id]));
          return json(res,200,{item:rowDTO(updated)});
        }
        if(method==='POST'&&action==='submit') {
          businessData(kind,current.data,{submit:true});
          const updated=one(await tx.query(`UPDATE sb.${spec.table} SET status='submitted' WHERE public_id=$1 RETURNING *`,[id]));
          return json(res,200,{item:rowDTO(updated)});
        }
        throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
      });
    }
    if (method==='GET' && route==='/api/opportunities') {
      if(!ctx.roles.some(role=>['buyer','partner'].includes(role)))throw new ApiError(403,'APPROVAL_REQUIRED','Approved buyer or partner access is required.');
      const query=text(url.searchParams.get('q')||'','search',{max:120});
      const category=categoryId(url.searchParams.get('categoryId'),{optional:true}),subcategory=categoryId(url.searchParams.get('subcategoryId'),{optional:true});
      const sort=oneOf(url.searchParams.get('sort')||'newest',['newest','oldest','title'],'sort');
      const positive=(name,fallback,max)=>{const value=url.searchParams.get(name);if(value===null)return fallback;if(!/^[1-9][0-9]*$/.test(value)||Number(value)>max)throw new ApiError(400,'INVALID_FILTER','Invalid pagination.');return Number(value);};
      const page=positive('page',1,1000000),limit=positive('limit',12,24);
      const base="( $1='' OR data->>'title' ILIKE '%'||$1||'%' OR data->>'specification' ILIKE '%'||$1||'%' )";
      const filtered=base+' AND ($2::uuid IS NULL OR category_id=$2::uuid) AND ($3::uuid IS NULL OR subcategory_id=$3::uuid)';
      const ordering=sort==='oldest'?'created_at ASC,public_id':sort==='title'?"lower(data->>'title'),public_id":'created_at DESC,public_id';
      return txFor(ctx,async tx=>{
        // Every aggregate and page uses the same recipient-enforced RLS table.
        const total=Number((await tx.query(`SELECT count(*) FROM portal.opportunities WHERE ${filtered}`,[query,category,subcategory])).rows[0].count);
        const items=(await tx.query(`SELECT public_id,status,data,created_at,category_id,subcategory_id,classification_review_required FROM portal.opportunities WHERE ${filtered} ORDER BY ${ordering} LIMIT $4 OFFSET $5`,[query,category,subcategory,limit,(page-1)*limit])).rows.map(rowDTO);
        const categoryCounts=(await tx.query(`SELECT category_id AS "categoryId",count(*)::integer AS count FROM portal.opportunities WHERE ${base} GROUP BY category_id ORDER BY category_id`,[query])).rows;
        return json(res,200,{items,page,limit,total,pages:Math.max(1,Math.ceil(total/limit)),categoryCounts});
      });
    }
    const opportunity=route.match(/^\/api\/opportunities\/([A-Za-z0-9-]+)(?:\/(enquiries))?$/);
    if(opportunity) {
      const id=identifier(opportunity[1]);
      return txFor(ctx,async tx=>{
        const card=one(await tx.query('SELECT public_id,status,data,created_at,category_id,subcategory_id,classification_review_required FROM portal.opportunities WHERE public_id=$1',[id]));
        if(method==='GET'&&!opportunity[2])return json(res,200,{item:rowDTO(card)});
        if(method==='POST'&&opportunity[2]) {
          const input=object(await body(req),['body'],['body']);const message=text(input.body,'message',{min:2,max:10000});
          const item=one(await tx.query("INSERT INTO sb.messages(resource_type,resource_public_id,sender_user_id,body) VALUES('opportunity',$1,$2,$3) RETURNING public_id,body,created_at",[id,identity.id,message]));
          return json(res,201,{item:{id:item.public_id,body:item.body,createdAt:item.created_at,recipient:'ShadowBridge'}});
        }
        throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
      });
    }
    if (route==='/api/messages') {
      const input=method==='GET'?{resourceType:url.searchParams.get('resourceType'),resourceId:url.searchParams.get('resourceId'),companyId:url.searchParams.get('companyId')}:object(await body(req),['resourceType','resourceId','body','companyId'],['resourceType','resourceId','body']);
      const kind=oneOf(input.resourceType,['offer','rfq','opportunity','proposal'],'resource type');const id=identifier(input.resourceId);
      if(input.companyId&&!ctx.staff)throw new ApiError(400,'INVALID_FIELDS','Company routing is managed by ShadowBridge.');
      const targetCompany=input.companyId?identifier(input.companyId):null;
      if(kind==='opportunity'&&ctx.staff&&!targetCompany)throw new ApiError(400,'RECIPIENT_REQUIRED','Choose the company conversation explicitly.');
      return txFor(ctx,async tx=>{
        if(!(await tx.query('SELECT sb.can_access_resource($1,$2) AS allowed',[kind,id])).rows[0].allowed)throw new ApiError(404,'NOT_FOUND','Record not found.');
        if(method==='GET')return json(res,200,{items:(await tx.query('SELECT public_id,body,created_at,sender_user_id=$3 AS own FROM sb.messages WHERE resource_type=$1 AND resource_public_id=$2 AND ($4::uuid IS NULL OR company_id=$4::uuid) ORDER BY created_at LIMIT 200',[kind,id,identity.id,targetCompany])).rows.map(x=>({id:x.public_id,body:x.body,createdAt:x.created_at,direction:x.own?'you':'ShadowBridge'}))});
        if(method==='POST'){const message=text(input.body,'message',{min:2,max:8000});if(ctx.staff)await guardReleasedText(tx,[message],targetCompany);const item=one(await tx.query('INSERT INTO sb.messages(resource_type,resource_public_id,sender_user_id,body,company_id) VALUES($1,$2,$3,$4,$5::uuid) RETURNING *',[kind,id,identity.id,message,targetCompany]));return json(res,201,{item:{id:item.public_id,body:item.body,direction:'you',createdAt:item.created_at}});}
        throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
      });
    }
    if(method==='GET'&&['/api/projects','/api/commissions'].includes(route)) {
      needRole(ctx,'partner');
      return txFor(ctx,async tx=>{
        const result=route.endsWith('/projects')?await tx.query('SELECT public_id AS id,title,status,summary,created_at AS "createdAt" FROM sb.projects ORDER BY created_at DESC LIMIT 200'):await tx.query('SELECT p.public_id AS "projectId",c.amount,c.currency,c.agreement_reference AS "agreementReference",c.status,c.created_at AS "createdAt" FROM sb.commissions c JOIN sb.projects p ON p.id=c.project_id ORDER BY c.created_at DESC LIMIT 200');
        return json(res,200,{items:result.rows});
      });
    }
    if(route.startsWith('/api/admin/')) {
      needStaff(ctx);
      return txFor(ctx,async tx=>{
        const resource=route.slice('/api/admin/'.length).split('/')[0];
        if(method==='GET') await requirePermission(tx,({'contact-queue':'contact.read',applications:'applications.read',companies:'companies.read',offers:'offers.read',rfqs:'rfqs.read',proposals:'proposals.read',opportunities:'opportunities.read',projects:'projects.read',commissions:'commissions.read',audit:'audit.read'})[resource] || 'security.manage');
        if(method==='GET') {
          const adminLists={
            'contact-queue':'SELECT public_id AS id,name,email,company,role,message,status,created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM sb.contact_enquiries ORDER BY created_at DESC LIMIT 200',
            applications:'SELECT a.*,c.legal_name AS "companyName",c.country,ac.email FROM sb.applications a JOIN sb.companies c ON c.id=a.company_id JOIN sb.accounts ac ON ac.user_id=a.user_id ORDER BY a.created_at DESC LIMIT 200',
            companies:'SELECT c.*,ac.email,ac.status AS "accountStatus",m.role,m.status AS "membershipStatus",m.user_id AS "userId" FROM sb.companies c JOIN sb.accounts ac ON ac.user_id=c.created_by LEFT JOIN sb.memberships m ON m.company_id=c.id ORDER BY c.created_at DESC LIMIT 200',
            offers:'SELECT o.public_id AS id,o.status,o.data,o.created_at AS "createdAt",c.id AS "companyId",c.legal_name AS "companyName" FROM sb.offers o JOIN sb.companies c ON c.id=o.company_id ORDER BY o.created_at DESC LIMIT 200',
            rfqs:'SELECT r.public_id AS id,r.status,r.data,r.created_at AS "createdAt",c.id AS "companyId",c.legal_name AS "companyName" FROM sb.rfqs r JOIN sb.companies c ON c.id=r.company_id ORDER BY r.created_at DESC LIMIT 200',
            proposals:'SELECT p.public_id AS id,p.status,p.data,p.created_at AS "createdAt",c.id AS "companyId",c.legal_name AS "companyName" FROM sb.partner_proposals p JOIN sb.companies c ON c.id=p.company_id ORDER BY p.created_at DESC LIMIT 200',
            opportunities:'SELECT p.public_id AS id,p.data,p.status,p.created_at AS "createdAt" FROM portal.opportunities p ORDER BY p.created_at DESC LIMIT 200',
            projects:'SELECT public_id AS id,title,status,summary,partner_company_id AS "partnerCompanyId",created_at AS "createdAt" FROM sb.projects ORDER BY created_at DESC LIMIT 100',
            commissions:'SELECT p.public_id AS "projectId",c.amount,c.currency,c.agreement_reference AS "agreementReference",c.status,c.created_at AS "createdAt" FROM sb.commissions c JOIN sb.projects p ON p.id=c.project_id ORDER BY c.created_at DESC LIMIT 100',
            audit:'SELECT id,actor_id AS "actorId",action,resource,resource_id AS "resourceId",created_at AS "createdAt",metadata FROM sb.audit_events ORDER BY id DESC LIMIT 200',
          };
          const name=route.slice('/api/admin/'.length);if(adminLists[name]) {
            let items=(await tx.query(adminLists[name])).rows;
            if(name==='applications')items=items.map(x=>({...x,userId:x.user_id,companyId:x.company_id,role:x.requested_role,company:{name:x.companyName,country:x.country},profile:{}}));
            if(name==='companies')items=items.map(x=>({...x,name:x.legal_name,companyName:x.legal_name,registrationNumber:x.registration_number}));
            return json(res,200,{items});
          }
        }
        let match=route.match(/^\/api\/admin\/contact-queue\/([A-Za-z0-9-]+)\/status$/);
        if(method==='POST'&&match){
          await requirePermission(tx,'contact.edit');
          const input=object(await body(req),['status'],['status']);
          const status=oneOf(input.status,['new','in_review','replied','closed'],'status');
          const saved=one(await tx.query('UPDATE sb.contact_enquiries SET status=$1 WHERE public_id=$2 RETURNING public_id AS id,status,reviewed_at AS "reviewedAt"',[status,identifier(match[1])]));
          return json(res,200,{item:saved});
        }
        match=route.match(/^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/decision$/);
        if(method==='POST'&&match){const input=object(await body(req),['decision','reason'],['decision']);await requirePermission(tx,input.decision==='approved'?'applications.approve':'applications.reject');await tx.query('SELECT sb.decide_application($1::uuid,$2,$3)',[identifier(match[1]),oneOf(input.decision,['approved','rejected'],'decision'),text(input.reason||'','reason')]);return json(res,200,{updated:true});}
        match=route.match(/^\/api\/admin\/accounts\/([A-Za-z0-9-]+)\/status$/);
        if(method==='POST'&&match){await requirePermission(tx,'accounts.suspend');const input=object(await body(req),['status'],['status']);const status=oneOf(input.status,['active','suspended'],'status');const id=identifier(match[1]);if(id===identity.id&&status==='suspended')throw new ApiError(400,'SELF_SUSPENSION','Cannot suspend your current management account.');await tx.query('SELECT sb.suspend_account($1::uuid,$2)',[id,status]);return json(res,200,{updated:true});}
        match=route.match(/^\/api\/admin\/(offers|rfqs|proposals)\/([A-Za-z0-9-]+)\/decision$/);
        if(method==='POST'&&match){
          const kind=match[1],spec=tables[kind];
          const input=object(await body(req),['decision','reason'],['decision']);
          const states=kind==='offers'?['approved','rejected','clarification_requested','archived']:kind==='rfqs'?['in_review','clarification_requested','accepted','closed']:['in_review','accepted','declined'];
          const decision=oneOf(input.decision,states,'decision'), id=identifier(match[2]);
          const action=['approved','accepted'].includes(decision)?'approve':['rejected','declined'].includes(decision)?'reject':decision==='archived'?'archive':'edit';
          await requirePermission(tx,`${kind}.${action}`);
          if(kind==='offers'){
            await tx.query('SELECT sb.decide_workspace_offer($1,$2,$3)',[id,decision,text(input.reason||'','review reason',{min:10,max:2000})]);
            const saved=one(await tx.query('SELECT public_id,status,data,created_at,updated_at FROM sb.offers WHERE public_id=$1',[id]));
            return json(res,200,{item:rowDTO(saved)});
          }
          const current=one(await tx.query(`SELECT status FROM sb.${spec.table} WHERE public_id=$1 FOR UPDATE`,[id]));
          if(current.status==='draft')throw new ApiError(409,'NOT_SUBMITTED','Review only submitted records.');
          const updated=one(await tx.query(`UPDATE sb.${spec.table} SET status=$1 WHERE public_id=$2 RETURNING *`,[decision,id]));
          if(input.reason){await guardReleasedText(tx,[input.reason]);await tx.query('INSERT INTO sb.messages(resource_type,resource_public_id,sender_user_id,body) VALUES($1,$2,$3,$4)',[spec.type,id,identity.id,text(input.reason,'reason',{min:2,max:8000})]);}
          return json(res,200,{item:rowDTO(updated)});
        }
        if(method==='POST'&&route==='/api/admin/opportunities') {
          await requirePermission(tx,'opportunities.create');await requirePermission(tx,'opportunities.approve');
          const input=object(await body(req),['sourceOfferId','commercial','reviewedNonIdentifying'],['sourceOfferId','commercial','reviewedNonIdentifying']);
          if(input.reviewedNonIdentifying!==true)throw new ApiError(400,'REVIEW_REQUIRED','Manually review every field for identifying information.');
          const commercial=businessData('commercial',input.commercial,{submit:true});await guardReleasedText(tx,Object.entries(commercial).filter(([key])=>!['categoryId','subcategoryId'].includes(key)).map(([,value])=>value));const source=one(await tx.query('SELECT id,status FROM sb.offers WHERE public_id=$1',[identifier(input.sourceOfferId)]));
          if(source.status!=='approved')throw new ApiError(409,'OFFER_NOT_APPROVED','Approve the source offer before creating an anonymous card.');
          const id=(await tx.query('SELECT sb.publish_opportunity($1::uuid,$2::jsonb) AS id',[source.id,JSON.stringify(commercial)])).rows[0].id;
          return json(res,201,{item:rowDTO(one(await tx.query('SELECT * FROM portal.opportunities WHERE public_id=$1',[id])))});
        }
        match=route.match(/^\/api\/admin\/opportunities\/([A-Za-z0-9-]+)\/assign$/);
        if(method==='POST'&&match){await requirePermission(tx,'opportunities.share');const input=object(await body(req),['recipientCompanyId','role','expiresAt'],['recipientCompanyId','role']);await tx.query('SELECT sb.grant_opportunity($1,$2::uuid,$3,$4::timestamptz)',[identifier(match[1]),identifier(input.recipientCompanyId),oneOf(input.role,['buyer','partner'],'role'),input.expiresAt||null]);return json(res,200,{assigned:true});}
        if(method==='POST'&&route==='/api/admin/projects') {
          await requirePermission(tx,'projects.create');
          const input=object(await body(req),['partnerCompanyId','title','summary','reviewedNonIdentifying'],['partnerCompanyId','title','reviewedNonIdentifying']);const company=identifier(input.partnerCompanyId);if(input.reviewedNonIdentifying!==true)throw new ApiError(400,'REVIEW_REQUIRED','Review partner-visible text for identifying information.');await guardReleasedText(tx,[input.title,input.summary||''],company);
          if(!(await tx.query('SELECT sb.project_partner_eligible($1::uuid) AS eligible',[company])).rows[0].eligible)throw new ApiError(400,'PARTNER_NOT_APPROVED','Assign only to an approved partner.');
          const project=one(await tx.query('INSERT INTO sb.projects(partner_company_id,title,summary) VALUES($1,$2,$3) RETURNING public_id AS id,title,status,summary',[company,text(input.title,'title',{min:2,max:200}),text(input.summary||'','summary')]));return json(res,201,{item:project});
        }
        if(method==='POST'&&route==='/api/admin/commissions') {
          await requirePermission(tx,'commissions.create');
          const input=object(await body(req),['projectId','amount','currency','agreementReference','agreementConfirmed','reviewedNonIdentifying','approvalId'],['projectId','amount','currency','agreementReference','agreementConfirmed','reviewedNonIdentifying']);
          if(input.agreementConfirmed!==true||input.reviewedNonIdentifying!==true)throw new ApiError(400,'AGREEMENT_REQUIRED','Record only actual agreed commission terms.');
          if(!/^[A-Z0-9-]{3,80}$/.test(input.agreementReference))throw new ApiError(400,'IDENTIFYING_CONTENT','Use a non-identifying agreement reference code.');
          const project=one(await tx.query('SELECT id,partner_company_id FROM sb.projects WHERE public_id=$1',[identifier(input.projectId)]));
          const currency=oneOf(input.currency,currencyCodes,'currency');
          if(input.approvalId)await tx.query("SELECT set_config('request.risk_approval_id',$1,true)",[identifier(input.approvalId)]);
          await tx.query("INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency,agreement_reference,status) VALUES($1,$2,$3,$4,$5,'agreed')",[project.id,project.partner_company_id,number(input.amount,'amount'),currency,text(input.agreementReference,'agreement reference',{min:3,max:80})]);
          return json(res,201,{recorded:true});
        }
        throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
      });
    }
    throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
  }
  async function staticFile(req,res,url) {
    if(req.method!=='GET'&&req.method!=='HEAD')throw new ApiError(405,'METHOD_NOT_ALLOWED','Method not allowed.');
    let pathname=decodeURIComponent(url.pathname);
    if(pathname.startsWith('/portal')) { const ctx=await context(await auth.authenticate(req)); if(!ctx||ctx.identity.recoveryOnly){res.writeHead(303,{Location:'/member-sign-in/'});return res.end();} }
    const publicPage=/^\/(?:index\.html|apply\/(?:buyer|supplier|partner)\/(?:index\.html)?|member-sign-in\/(?:index\.html)?|legal\/(?:index\.html)?|cartel\/(?:index\.html)?|portal\/(?:(?:buyer|supplier|partner|admin|offers)\/)?(?:index\.html)?)?$/;
    const asset=/^\/assets\/(?:[a-zA-Z0-9-]+|content\.en)\.(?:css|js|svg|png)$|^\/assets\/fonts\/[a-zA-Z0-9.-]+\.(?:woff2|txt|json)$/;
    if(config.appEnv==='production'&&/^\/assets\/prototypes\.(?:js|css)$/.test(pathname))throw new ApiError(404,'NOT_FOUND','Not found.');
    const prototype=config.appEnv!=='production'&&/^\/prototypes\/(?:(?:buyer|supplier|partner)\/)?(?:index\.html)?$/.test(pathname);
    if(!publicPage.test(pathname)&&!asset.test(pathname)&&!prototype&&!['/robots.txt','/sitemap.xml'].includes(pathname))throw new ApiError(404,'NOT_FOUND','Not found.');
    if(pathname.endsWith('/'))pathname+='index.html';
    const target=path.join(root,pathname);
    const real=await fs.realpath(target).catch(()=>null);
    if(!real||!real.startsWith(root+path.sep))throw new ApiError(404,'NOT_FOUND','Not found.');
    const data=await fs.readFile(real);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain','.xml':'application/xml','.json':'application/json'};
    res.writeHead(200,{'Content-Type':types[path.extname(real)]||'application/octet-stream','Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
  }
  const server=http.createServer(async(req,res)=>{
    headers(res,config);const requestId=randomUUID();res.setHeader('X-Request-ID',requestId);
    try {
      const url=new URL(req.url,config.appUrl);
      if(url.pathname==='/health'){await db.pool.query('SELECT 1');return json(res,200,{ok:true,environment:config.appEnv});}
      if(req.method==='GET'&&['/auth/confirm','/auth/recover'].includes(url.pathname)){
        const token=url.searchParams.get('token')||url.searchParams.get('token_hash');
        if(!token)throw new ApiError(400,'INVALID_LINK','Verification link is invalid.');
        if(url.pathname==='/auth/confirm'){const verified=await auth.confirmEmail({token},res,req);await consumeIntent(req,res,verified);}else await auth.confirmRecovery({token},res,req);
        res.writeHead(303,{Location:url.pathname==='/auth/confirm'?'/portal/':'/member-sign-in/?recovery=1','Cache-Control':'no-store'});return res.end();
      }
      if(url.pathname.startsWith('/api/')) {
        // Do not acknowledge a write before its PostgreSQL transaction commits.
        res.deferJson=true;await api(req,res,url);res.deferJson=false;
        if(!res.stagedJson)throw new ApiError(500,'INTERNAL_ERROR','The service did not complete the request.');
        return json(res,res.stagedJson.status,res.stagedJson.data);
      }
      return await staticFile(req,res,url);
    } catch(error) {
      res.deferJson=false;res.stagedJson=null;
      if(error.code==='42501' && error.message==='Fresh owner MFA required') error=new ApiError(403,'FRESH_MFA_REQUIRED','Reconfirm your Owner MFA before this critical action.');
      else if(error.code==='42501' && error.message==='Additional owner authorization required for commission limit or currency') error=new ApiError(403,'ADDITIONAL_AUTHORIZATION_REQUIRED','Request separate Owner authorization for this amount and currency.');
      const status=error.status||({'42501':403,'23505':409,'23503':400,'23514':400,'22P02':400,'22023':400,'54000':429,'P0001':400}[error.code])||500;
      if(status===429)res.setHeader('Retry-After','900');
      const code=error.status?error.code:status===500?'INTERNAL_ERROR':status===403?'FORBIDDEN':'INVALID_OPERATION';
      if(status===500)console.error(`Request ${requestId} failed (${typeof error.code==='string'?error.code:'internal'}). No request data logged.`);
      json(res,status,{error:error.status?error.message:status===429?'Please wait before submitting another enquiry.':status===500?'The service could not complete this request.':'Operation is not allowed for this record.',code,requestId});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,db,auth,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=loadConfig();const app=createApp({config});
  app.server.listen(config.port,config.host,()=>console.log(`ShadowBridge ${config.appEnv} backend ready on ${config.host}:${config.port}. No production deployment performed.`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
