// Authorized recruitment projections only. Company existence/qualification and
// membership approval remain separate decisions; no Auth secrets are selected.
import { ApiError, text, oneOf } from './validation.mjs';
import { requirePermission } from './staff-management.mjs';

const stages = ['email_pending', 'application_missing', 'pending_review', 'approved', 'rejected', 'suspended'];
function pagination(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ApiError(400, 'INVALID_FILTER', 'Use supported, unambiguous recruitment filters.');
  }
  const integer = (key, fallback, maximum) => {
    const value = url.searchParams.get(key) ?? String(fallback);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`);
    return Number(value);
  };
  const page = integer('page', 1, 10000), limit = integer('limit', 12, 24);
  return { page, limit, offset: (page - 1) * limit };
}
function pageResult(data, { page, limit }) {
  const total = Number(data.total);
  return { ...data, total, page, limit, pages: Math.ceil(total / limit) };
}
export async function routeRecruitment({ req, url, tx }) {
  if (req.method !== 'GET') return null;
  const route = url.pathname;
  if (!['/api/admin/accounts', '/api/admin/applications'].includes(route) && !/^\/api\/admin\/applications\/[^/]+\/history$/.test(route)) return null;
  const accounts = route === '/api/admin/accounts';
  await requirePermission(tx, accounts ? 'accounts.read' : 'applications.read');
  await requirePermission(tx, 'counterparties.read');
  // A role unable to see application rows must not misclassify them as missing.
  if (accounts) await requirePermission(tx, 'applications.read');

  if (route.endsWith('/history')) {
    const id = route.split('/')[4];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError(400, 'INVALID_ID', 'Invalid application reference.');
    const page = pagination(url, ['page', 'limit']);
    const visible = await tx.query('SELECT a.id FROM sb.applications a JOIN sb.accounts u ON u.user_id=a.user_id WHERE a.id=$1::uuid AND u.email_verified_at IS NOT NULL', [id]);
    if (!visible.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Application not found.');
    const result = await tx.query(`
      WITH history AS (
        SELECT id::text AS id,status AS decision,reason,reviewed_by AS "actorId",
          reviewed_at AS "createdAt",recorded_at AS "recordedAt",source
        FROM sb.application_decisions WHERE application_id=$1::uuid
      )
      SELECT jsonb_build_object(
        'items', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."recordedAt" DESC,p.id::bigint DESC)
          FROM (SELECT * FROM history ORDER BY "recordedAt" DESC,id::bigint DESC LIMIT $2 OFFSET $3) p),'[]'::jsonb),
        'total',(SELECT count(*) FROM history)) AS result`, [id, page.limit, page.offset]);
    return { status: 200, data: pageResult(result.rows[0].result, page) };
  }

  const page = pagination(url, ['page', 'limit', 'q', accounts ? 'stage' : 'status']);
  const q = text(url.searchParams.get('q') ?? '', 'search', { max: 100 });
  const filter = url.searchParams.get(accounts ? 'stage' : 'status') || '';
  oneOf(filter, ['', ...(accounts ? stages : ['pending', 'approved', 'rejected'])], 'recruitment status');
  let sql;
  if (accounts) {
    sql = `
      WITH base AS (
        SELECT u.user_id AS "userId",u.email,u.status,u.email_verified_at IS NOT NULL AS "emailVerified",
          u.email_verified_at AS "emailVerifiedAt",u.created_at AS "createdAt",
          a.id AS "applicationId",a.status AS "applicationStatus",a.requested_role AS role,
          a.company_id AS "companyId",c.legal_name AS "companyName",a.reviewed_at AS "reviewedAt",
          a.decision_note AS "decisionReason",
          CASE WHEN u.status='suspended' THEN 'suspended'
            WHEN u.email_verified_at IS NULL THEN 'email_pending'
            WHEN a.id IS NULL THEN 'application_missing'
            WHEN a.status='pending' THEN 'pending_review' ELSE a.status END AS stage
        FROM sb.accounts u
        LEFT JOIN LATERAL (SELECT x.* FROM sb.applications x WHERE x.user_id=u.user_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) a ON true
        LEFT JOIN sb.companies c ON c.id=a.company_id
        WHERE $1::text='' OR strpos(lower(u.email),lower($1))>0
          OR strpos(lower(coalesce(c.legal_name,'')),lower($1))>0
      ), filtered AS (SELECT * FROM base WHERE $2::text='' OR stage=$2)
      SELECT jsonb_build_object(
        'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."createdAt" DESC,p."userId" DESC)
          FROM (SELECT * FROM filtered ORDER BY "createdAt" DESC,"userId" DESC LIMIT $3 OFFSET $4) p),'[]'::jsonb),
        'total',(SELECT count(*) FROM filtered),
        'counts',(SELECT jsonb_build_object(
          'email_pending',count(*) FILTER(WHERE stage='email_pending'),
          'application_missing',count(*) FILTER(WHERE stage='application_missing'),
          'pending_review',count(*) FILTER(WHERE stage='pending_review'),
          'approved',count(*) FILTER(WHERE stage='approved'),
          'rejected',count(*) FILTER(WHERE stage='rejected'),
          'suspended',count(*) FILTER(WHERE stage='suspended')) FROM base)) AS result`;
  } else {
    sql = `
      WITH base AS (
        SELECT a.id,a.user_id AS "userId",a.company_id AS "companyId",u.email,
          a.requested_role AS role,a.status,a.created_at AS "createdAt",
          a.reviewed_at AS "reviewedAt",a.reviewed_by AS "reviewedBy",a.decision_note AS "decisionReason",
          u.status AS "accountStatus",true AS "emailVerified",
          jsonb_build_object('name',c.legal_name,'country',c.country,'registrationNumber',c.registration_number) AS company,
          jsonb_build_object('countries',coalesce(p.countries,ARRAY[]::text[]),
            'sectors',coalesce(p.sectors,ARRAY[]::text[]),'summary',coalesce(p.summary,'')) AS profile
        FROM sb.applications a JOIN sb.accounts u ON u.user_id=a.user_id AND u.email_verified_at IS NOT NULL
        LEFT JOIN sb.companies c ON c.id=a.company_id
        LEFT JOIN sb.professional_profiles p ON p.user_id=a.user_id AND p.company_id=a.company_id
        WHERE $1::text='' OR strpos(lower(u.email),lower($1))>0
          OR strpos(lower(coalesce(c.legal_name,'')),lower($1))>0
          OR strpos(lower(coalesce(c.registration_number,'')),lower($1))>0
      ), filtered AS (SELECT * FROM base WHERE $2::text='' OR status=$2)
      SELECT jsonb_build_object(
        'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."createdAt" DESC,p.id DESC)
          FROM (SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC LIMIT $3 OFFSET $4) p),'[]'::jsonb),
        'total',(SELECT count(*) FROM filtered)) AS result`;
  }
  const result = await tx.query(sql, [q, filter, page.limit, page.offset]);
  return { status: 200, data: pageResult(result.rows[0].result, page) };
}
