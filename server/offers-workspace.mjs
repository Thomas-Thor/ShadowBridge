import { ApiError, object, text, oneOf, identifier, businessData } from './validation.mjs';

const prefix = '/api/staff/offers';
const states = ['', 'draft', 'submitted', 'clarification_requested', 'approved', 'rejected', 'archived'];
const sourceKinds = ['unreviewed', 'supplier_owned', 'manufacturer_authorized', 'independent_inspection', 'marketplace_copy'];
const sellerKinds = ['manufacturer', 'distributor', 'stock_owner', 'authorized_seller'];
function integer(value, fallback, max) {
  if (value === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max) throw new ApiError(400, 'INVALID_FILTER', 'Invalid pagination value.');
  return Number(value);
}
function found(value) {
  if (!value) throw new ApiError(404, 'NOT_FOUND', 'Offer not found.');
  return value;
}

async function detailItem(tx, id) {
  const result = await tx.query('SELECT sb.workspace_offer($1) AS item', [id]);
  const item = found(result.rows[0].item);
  const access = await tx.query("SELECT sb.has_permission('supplier_verifications.read') AND sb.has_permission('counterparties.read') AS allowed");
  if (access.rows[0].allowed) item.supplierQualification = (await tx.query('SELECT sb.workspace_supplier_qualification($1) AS item', [id])).rows[0].item;
  return item;
}

/** Run inside db.asUser. Return a response only; the caller sends it after COMMIT. */
export async function routeOffersWorkspace({ req, url, tx, body }) {
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const method = req.method;
  if (url.pathname === prefix && method === 'GET') {
    const allowed = ['q', 'status', 'sort', 'page', 'limit', 'categoryId', 'subcategoryId'];
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key))) throw new ApiError(400, 'INVALID_FILTER', 'Unsupported offer filter.');
    const query = text(url.searchParams.get('q') || '', 'search', { max: 100 });
    const state = oneOf(url.searchParams.get('status') || '', states, 'status');
    const sort = oneOf(url.searchParams.get('sort') || 'newest', ['newest', 'oldest', 'updated', 'price_asc', 'price_desc'], 'sort');
    const page = integer(url.searchParams.get('page'), 1, 100000);
    const limit = integer(url.searchParams.get('limit'), 12, 24);
    const categoryId = url.searchParams.get('categoryId') || null;
    const subcategoryId = url.searchParams.get('subcategoryId') || null;
    for (const value of [categoryId, subcategoryId]) if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, 'INVALID_FILTER', 'Invalid category identifier.');
    if (subcategoryId && !categoryId) throw new ApiError(400, 'INVALID_FILTER', 'Choose the parent category first.');
    const result = await tx.query('SELECT sb.workspace_offers($1,$2,$3,$4,$5,$6::uuid,$7::uuid) AS result', [query, state, sort, page, limit, categoryId, subcategoryId]);
    return { status: 200, data: result.rows[0].result };
  }
  const match = url.pathname.match(/^\/api\/staff\/offers\/([A-Za-z0-9-]+)(?:\/(details|assignment|decision|source-review|supplier-qualification))?$/);
  if (!match) throw new ApiError(404, 'NOT_FOUND', 'Offer endpoint not found.');
  const id = identifier(match[1]);
  const operation = match[2] || '';
  if (method === 'GET' && operation === '') {
    return { status: 200, data: { item: await detailItem(tx, id) } };
  }
  if (method === 'GET' && operation === 'supplier-qualification') {
    const result = await tx.query('SELECT sb.workspace_supplier_qualification($1) AS item', [id]);
    return { status: 200, data: { item: found(result.rows[0].item) } };
  }
  if (method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  if (operation === 'details') {
    const input = object(await body(req), ['data'], ['data']);
    const data = businessData('offers', input.data);
    if (!Object.keys(data).length) throw new ApiError(400, 'INVALID_INPUT', 'Provide offer fields to update.');
    await tx.query('SELECT sb.edit_workspace_offer($1,$2::jsonb)', [id, JSON.stringify(data)]);
  } else if (operation === 'assignment') {
    const input = object(await body(req), ['responsible'], ['responsible']);
    await tx.query('SELECT sb.assign_workspace_offer($1,$2)', [id, oneOf(input.responsible, ['me', 'unassigned'], 'responsible')]);
  } else if (operation === 'source-review') {
    const input = object(await body(req), ['sourceKind', 'reason'], ['sourceKind', 'reason']);
    await tx.query('SELECT sb.set_workspace_source($1,$2,$3)', [id, oneOf(input.sourceKind, sourceKinds, 'source kind'), text(input.reason, 'source evidence review', { min: 20, max: 2000 })]);
  } else if (operation === 'supplier-qualification') {
    const input = object(await body(req), ['stage', 'decision', 'sellerKind', 'reason', 'evidenceReference'], ['stage', 'decision', 'sellerKind', 'reason', 'evidenceReference']);
    await tx.query('SELECT sb.review_supplier_qualification($1,$2,$3,$4,$5,$6)', [id,
      oneOf(input.stage, ['company', 'right_to_sell', 'documents_goods', 'decision'], 'qualification stage'),
      oneOf(input.decision, ['verified', 'rejected'], 'qualification decision'), oneOf(input.sellerKind, sellerKinds, 'seller kind'),
      text(input.reason, 'review reason', { min: 20, max: 2000 }), text(input.evidenceReference, 'reviewed evidence reference', { min: 6, max: 300 }),
    ]);
  } else if (operation === 'decision') {
    const input = object(await body(req), ['decision', 'reason'], ['decision', 'reason']);
    await tx.query('SELECT sb.decide_workspace_offer($1,$2,$3)', [id, oneOf(input.decision, ['approved', 'rejected', 'clarification_requested', 'archived'], 'decision'), text(input.reason, 'review reason', { min: 10, max: 2000 })]);
  } else throw new ApiError(404, 'NOT_FOUND', 'Offer endpoint not found.');
  return { status: 200, data: { updated: true, item: await detailItem(tx, id) } };
}
