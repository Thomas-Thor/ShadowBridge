import { ApiError, object, text, oneOf, identifier } from './validation.mjs';

const optional = (value, name, max) => value === undefined ? '' : text(value, name, { max });
const version = value => {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, 'INVALID_INPUT', 'Use the current record version.');
  return value;
};
function httpsUrl(value, name) {
  value = optional(value, name, 500);
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new ApiError(400, 'INVALID_INPUT', `Invalid ${name}.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
      || (url.port && url.port !== '443') || !/^[A-Za-z0-9.-]+$/.test(url.hostname)) {
    throw new ApiError(400, 'INVALID_INPUT', `Use a canonical HTTPS ${name} without credentials, query or fragment.`);
  }
  return url.href;
}

export function vaultIntake(input) {
  object(input, ['company', 'contact', 'source'], ['company', 'contact', 'source']);
  const b = object(input.company, ['name', 'country', 'registrationNumber', 'sector', 'website'], ['name', 'country']);
  const c = object(input.contact, ['fullName', 'title', 'workEmail', 'emailKind', 'professionalUrl'], ['fullName']);
  const s = object(input.source, ['system', 'recordId', 'url'], ['system', 'recordId']);
  const country = text(b.country, 'country', { min: 2, max: 2 }).toUpperCase();
  const system = text(s.system, 'source system', { min: 2, max: 40 });
  const email = optional(c.workEmail, 'work email', 254).toLowerCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[a-z][a-z0-9_-]{1,39}$/.test(system)
      || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError(400, 'INVALID_INPUT', 'Invalid country, source or work email.');
  return {
    company: { name: text(b.name, 'company name', { min: 2, max: 200 }), country,
      registrationNumber: optional(b.registrationNumber, 'registration number', 100).toUpperCase(),
      sector: optional(b.sector, 'sector', 200), website: httpsUrl(b.website, 'company website') },
    contact: { fullName: text(c.fullName, 'full name', { min: 2, max: 200 }), title: optional(c.title, 'title', 200),
      workEmail: email, emailKind: oneOf(c.emailKind ?? 'unknown', ['individual', 'shared', 'unknown'], 'email kind'),
      professionalUrl: httpsUrl(c.professionalUrl, 'professional profile') },
    source: { system, recordId: text(s.recordId, 'source record', { min: 1, max: 200 }), url: httpsUrl(s.url, 'source URL') },
  };
}

function integer(value, fallback, max) {
  if (value === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max) throw new ApiError(400, 'INVALID_INPUT', 'Invalid Vault page or limit.');
  return Number(value);
}

export async function routeOwnerVault({ req, url, tx, body }) {
  const route = url.pathname, method = req.method;
  if (!route.startsWith('/api/owner/vault')) return null;
  const allowed = (await tx.query('SELECT owner_vault.check_access() AS allowed')).rows[0].allowed;
  if (!allowed) return { status: 403, data: { code: 'OWNER_REQUIRED', error: 'Owner Vault requires an active OWNER account and MFA.' } };
  const result = (status, data) => ({ status, data });
  if (method === 'GET' && route === '/api/owner/vault/workspace/statistics') {
    if ([...url.searchParams].length) throw new ApiError(400, 'INVALID_INPUT', 'Statistics uses the server clock.');
    return result(200, (await tx.query('SELECT owner_vault.workspace_statistics() AS data')).rows[0].data);
  }
  const workspace = route.match(/^\/api\/owner\/vault\/workspace\/(contacts|companies|intakes|history)(?:\/([a-f0-9-]+))?$/i);
  if (method === 'GET' && workspace) {
    const allowed = ['q', 'status', 'page', 'limit', 'companyId', 'period', 'country', 'queue'];
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length > 1) throw new ApiError(400, 'INVALID_INPUT', 'Unknown or repeated Vault filter.');
    const data = (await tx.query('SELECT owner_vault.read_workspace($1,$2,$3,$4,$5,$6::uuid,$7::uuid,$8,$9,$10) AS data', [workspace[1],
      text(url.searchParams.get('q') || '', 'query', { max: 100 }),
      oneOf(url.searchParams.get('status') || '', ['', 'unconfirmed', 'confirmed', 'review_required', 'accepted', 'duplicate_prevented', 'dismissed'], 'status'),
      integer(url.searchParams.get('page'), 1, 10000), integer(url.searchParams.get('limit'), 25, 50), workspace[2] ? identifier(workspace[2]) : null,
      url.searchParams.get('companyId') ? identifier(url.searchParams.get('companyId')) : null,
      oneOf(url.searchParams.get('period') || '', ['', 'overnight'], 'period'),
      text(url.searchParams.get('country') || '', 'country', { max: 2 }).toUpperCase(),
      oneOf(url.searchParams.get('queue') || '', ['', 'open', 'resolved'], 'review queue')])).rows[0].data;
    return result(200, data);
  }
  const edit = route.match(/^\/api\/owner\/vault\/(contacts|companies)\/([a-f0-9-]+)$/i);
  const resolve = route.match(/^\/api\/owner\/vault\/intakes\/([a-f0-9-]+)\/resolve$/i);
  if (method === 'PATCH' && edit) {
    const input = object(await body(req), ['data', 'version', 'reason'], ['data', 'version', 'reason']);
    const data = vaultEdit(edit[1], input.data);
    try {
      await tx.query('SELECT owner_vault.edit_record($1,$2::uuid,$3::jsonb,$4,$5)', [edit[1] === 'contacts' ? 'contact' : 'company', identifier(edit[2]), JSON.stringify(data), version(input.version), text(input.reason, 'change reason', { min: 10, max: 500 })]);
    } catch (error) {
      if (error.code === '40001') throw new ApiError(409, 'VAULT_CONFLICT', 'The record changed or an identity key belongs to another contact. Reload and review; nothing was overwritten.');
      throw error;
    }
    return result(200, { updated: true });
  }
  if (method === 'POST' && resolve) {
    const input = object(await body(req), ['decision', 'contactId', 'version', 'reason'], ['decision', 'version', 'reason']);
    const decision = oneOf(input.decision, ['dismiss', 'link_existing'], 'resolution');
    const contactId = input.contactId == null || input.contactId === '' ? null : identifier(input.contactId);
    if ((decision === 'link_existing') !== (contactId !== null)) throw new ApiError(400, 'INVALID_INPUT', 'Link only a recorded candidate; dismissal has no contact.');
    try {
      await tx.query('SELECT owner_vault.resolve_intake($1::uuid,$2,$3::uuid,$4,$5)', [identifier(resolve[1]), decision, contactId, version(input.version), text(input.reason, 'resolution reason', { min: 10, max: 500 })]);
    } catch (error) {
      if (error.code === '40001') throw new ApiError(409, 'VAULT_CONFLICT', 'This review changed or strong identity/company evidence still conflicts. No identities were reassigned. Reload or dismiss with a documented reason.');
      throw error;
    }
    return result(200, { resolved: true });
  }
  if (method === 'GET' && route === '/api/owner/vault/statistics') {
    if ([...url.searchParams].length) throw new ApiError(400, 'INVALID_INPUT', 'Statistics uses the server clock.');
    return result(200, (await tx.query('SELECT owner_vault.statistics() AS data')).rows[0].data);
  }
  const read = route.match(/^\/api\/owner\/vault\/(contacts|companies|intakes|events)(?:\/([a-f0-9-]+))?$/i);
  if (method === 'GET' && read) {
    for (const key of url.searchParams.keys()) if (!['q', 'status', 'page', 'limit'].includes(key)) throw new ApiError(400, 'INVALID_INPUT', 'Unknown Vault filter.');
    const id = read[2] ? identifier(read[2]) : null;
    if (id && read[1] === 'events') throw new ApiError(400, 'INVALID_INPUT', 'Events use paginated listing.');
    const data = (await tx.query('SELECT owner_vault.read_records($1,$2,$3,$4,$5,$6::uuid) AS data', [read[1],
      text(url.searchParams.get('q') || '', 'query', { max: 100 }),
      oneOf(url.searchParams.get('status') || '', ['', 'unconfirmed', 'confirmed', 'review_required', 'accepted', 'duplicate_prevented'], 'status'),
      integer(url.searchParams.get('page'), 1, 10000), integer(url.searchParams.get('limit'), 25, 50), id])).rows[0].data;
    // A missing detail is still an audited successful lookup of zero records.
    return result(200, data);
  }
  if (method === 'POST' && route === '/api/owner/vault/contacts/preview') {
    const input = object(await body(req), ['record'], ['record']);
    return result(200, (await tx.query('SELECT owner_vault.preview_intake($1::jsonb) AS data', [JSON.stringify(vaultIntake(input.record))])).rows[0].data);
  }
  if (method === 'POST' && route === '/api/owner/vault/contacts') {
    const input = object(await body(req), ['record', 'requestKey'], ['record', 'requestKey']);
    const id = (await tx.query('SELECT owner_vault.owner_intake($1::jsonb,$2::uuid) AS id', [JSON.stringify(vaultIntake(input.record)), identifier(input.requestKey)])).rows[0].id;
    return result(201, { receipt: id });
  }
  const review = route.match(/^\/api\/owner\/vault\/contacts\/([a-f0-9-]+)\/review$/i);
  if (method === 'POST' && review) {
    const input = object(await body(req), ['status', 'version', 'reason'], ['status', 'version', 'reason']);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new ApiError(400, 'INVALID_INPUT', 'Use the current record version.');
    await tx.query('SELECT owner_vault.review_contact($1::uuid,$2,$3,$4)', [identifier(review[1]), oneOf(input.status, ['unconfirmed', 'confirmed', 'review_required'], 'verification status'),
      input.version, text(input.reason, 'review reason', { min: 10, max: 500 })]);
    return result(200, { updated: true });
  }
  throw new ApiError(404, 'NOT_FOUND', 'Vault endpoint not found.');
}

export function vaultEdit(section, input) {
  if (section === 'companies') {
    const p = object(input, ['name', 'sector', 'website', 'verificationStatus'], ['name', 'sector', 'website', 'verificationStatus']);
    return { name: text(p.name, 'company name', { min: 2, max: 200 }), sector: text(p.sector, 'sector', { max: 200 }), website: httpsUrl(p.website, 'company website'),
      verificationStatus: oneOf(p.verificationStatus, ['unconfirmed', 'confirmed', 'review_required'], 'company verification') };
  }
  if (section !== 'contacts') throw new ApiError(400, 'INVALID_INPUT', 'Invalid Vault editor.');
  const p = object(input, ['fullName', 'title', 'workEmail', 'emailKind', 'professionalUrl'], ['fullName', 'title', 'workEmail', 'emailKind', 'professionalUrl']);
  const email = text(p.workEmail, 'work email', { max: 254 }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid work email.');
  return { fullName: text(p.fullName, 'full name', { min: 2, max: 200 }), title: text(p.title, 'title', { max: 200 }), workEmail: email,
    emailKind: oneOf(p.emailKind, ['individual', 'shared', 'unknown'], 'email kind'), professionalUrl: httpsUrl(p.professionalUrl, 'professional profile') };
}
