import { spawn } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from 'pg';
import { ensureEnvironment, localEnvironment, root } from './dev-env.mjs';

// This operator-run fixture tool is NEVER an HTTP route or production bootstrap.
const origin = 'http://127.0.0.1:8088';
const mailbox = 'http://127.0.0.1:8025';
const directory = path.join(root, '.local');
const accountsFile = path.join(directory, 'demo-accounts.json');
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
const roles = ['buyer', 'supplier', 'partner', 'owner'];
class DemoError extends Error {}

function requireLocal(environment) {
  if (environment.APP_ENV !== 'local' || environment.APP_URL !== origin || environment.SUPABASE_URL !== 'http://127.0.0.1:9999' || environment.HOST !== '127.0.0.1' || environment.PORT !== '8088') throw new DemoError('Demo requires the generated loopback-only local configuration. Cloud and production are refused.');
  for (const name of ['DATABASE_ADMIN_URL', 'DATABASE_URL', 'SESSION_DATABASE_URL']) {
    const url = new URL(environment[name]);
    if (url.hostname !== '127.0.0.1' || url.port !== '54322' || url.pathname !== '/shadowbridge' || url.search || url.hash) throw new DemoError('Demo refuses a non-local database.');
  }
}

async function readAccounts() {
  const info = await lstat(accountsFile);
  if (!info.isFile() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new DemoError('Demo credentials must be a regular file owned by the current user.');
  await chmod(accountsFile, 0o600);
  const record = JSON.parse(await readFile(accountsFile, 'utf8'));
  if (record.kind !== 'shadowbridge-local-demo' || record.version !== 1 || !/^[a-f0-9]{12}$/.test(record.id)) throw new DemoError('Unrecognized local demo record; existing data was preserved.');
  for (const role of roles) {
    const actor = record.actors?.[role];
    if (!actor || actor.email !== `${role}.${record.id}@demo.shadowbridge.invalid` || !/^Sb![A-Za-z0-9_-]{32}9a$/.test(actor.password)) throw new DemoError('Invalid demo fixture namespace; no account was changed.');
  }
  return record;
}

async function save(record) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try { const info = await lstat(accountsFile); if (!info.isFile() || info.isSymbolicLink()) throw new DemoError('Refusing to replace a non-regular credentials file.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${accountsFile}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, accountsFile);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function loadOrCreateAccounts() {
  try { return await readAccounts(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const id = randomBytes(6).toString('hex');
  const record = { kind: 'shadowbridge-local-demo', version: 1, id, createdAt: new Date().toISOString(), actors: {}, fixtures: {} };
  for (const role of roles) record.actors[role] = {
    role: role === 'owner' ? 'partner' : role,
    email: `${role}.${id}@demo.shadowbridge.invalid`,
    password: `Sb!${randomBytes(24).toString('base64url')}9a`,
    companyName: `FICTIONAL DEMO ${role.toUpperCase()} ${id}`,
    registrationNumber: `DEMO-${id}-${role}`,
  };
  await save(record); // Persist random credentials BEFORE the first Auth request.
  return record;
}

class LocalClient {
  constructor() { this.cookies = new Map(); this.csrf = null; }
  async request(route, { method = 'GET', body, expected = [200] } = {}) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new DemoError('Only local application paths are allowed.');
    if (method !== 'GET' && !this.csrf) await this.request('/api/config');
    const headers = { Accept: 'application/json', Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') };
    if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf });
    const response = await fetch(`${origin}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    for (const raw of response.headers.getSetCookie()) {
      const match = /^([^=;]+)=([^;]*)/.exec(raw);
      if (match) { if (/max-age=0(?:;|$)/i.test(raw)) this.cookies.delete(match[1]); else this.cookies.set(match[1], match[2]); }
    }
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : (await response.arrayBuffer(), null);
    if (data?.csrfToken) this.csrf = data.csrfToken;
    if (!expected.includes(response.status)) throw new DemoError(`Local ${method} ${route.split('?')[0]} failed (HTTP ${response.status}, ${/^[A-Z_]+$/.test(data?.code || '') ? data.code : 'request rejected'}). Credentials and request data were not logged.`);
    return { status: response.status, data, headers: response.headers };
  }
  async login(actor) { return this.request('/api/auth/login', { method: 'POST', body: { email: actor.email, password: actor.password }, expected: [200, 400, 401, 403] }); }
}

async function confirmation(email) {
  const deadline = Date.now() + 30000;
  do {
    const list = await fetch(`${mailbox}/api/v1/messages`, { signal: AbortSignal.timeout(5000) });
    if (!list.ok) throw new DemoError('Local Mailpit is unavailable.');
    const messages = (await list.json()).messages || [];
    const entry = messages.find(item => (item.To || []).some(to => to.Address?.toLowerCase() === email));
    if (entry) {
      const response = await fetch(`${mailbox}/api/v1/message/${encodeURIComponent(entry.ID)}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new DemoError('Local verification message could not be read.');
      const message = await response.json();
      const content = [message.HTML, message.Text].filter(Boolean).join('\n').replaceAll('&amp;', '&');
      const link = (content.match(/https?:\/\/[^\s<>"']+/g) || []).find(value => /\/auth\/confirm|\/verify\?/.test(value));
      if (!link) throw new DemoError('The real Auth message did not contain a confirmation link.');
      return new URL(link);
    }
    await sleep(250);
  } while (Date.now() < deadline);
  throw new DemoError('Local verification message was not received. Restart preserves the fixture credentials.');
}

async function verifyMail(client, email) {
  let url = await confirmation(email);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!['http://127.0.0.1:8088', 'http://127.0.0.1:9999'].includes(url.origin) || url.username || url.password) throw new DemoError('Verification refuses any non-loopback redirect.');
    let response;
    if (url.origin === origin) response = await client.request(`${url.pathname}${url.search}`, { expected: [200, 302, 303] });
    else { const raw = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); response = { status: raw.status, headers: raw.headers }; await raw.arrayBuffer(); if (![200, 302, 303].includes(raw.status)) throw new DemoError('Local Auth verification failed.'); }
    const next = response.headers.get('location');
    if (!next) return;
    url = new URL(next, url);
    if (url.origin === origin && !/^\/auth\/confirm/.test(url.pathname)) return;
  }
  throw new DemoError('Local verification redirect limit exceeded.');
}

export function totp(secret, timestamp = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.toUpperCase().replace(/[=\s-]/g, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new DemoError('Invalid local authenticator secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30000)));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function prepareActor(record, label) {
  const actor = record.actors[label];
  const client = new LocalClient();
  let login = await client.login(actor);
  if (login.status !== 200) {
    if (!actor.registered) {
      await client.request('/api/auth/register', { method: 'POST', expected: [202], body: {
        email: actor.email, password: actor.password, role: actor.role,
        company: { name: actor.companyName, registrationNumber: actor.registrationNumber, country: 'NO' },
        profile: { countries: ['NO', 'SE'], sectors: ['Industrial materials'], summary: 'FICTIONAL local demonstration. No real counterparty information.' },
      } });
      actor.registered = true; await save(record);
    }
    await verifyMail(client, actor.email);
    login = await client.login(actor);
    if (login.status !== 200) throw new DemoError(`Could not sign in to the generated ${label} account. Existing accounts were preserved; no password was reset.`);
  }
  let user = (await client.request('/api/session')).data.user;
  if (!user?.emailVerified || user.email !== actor.email || (actor.userId && actor.userId !== user.id)) throw new DemoError('The local fixture identity could not be verified.');
  if (user.applicationStatus === 'not_submitted') {
    await client.request('/api/application', { method: 'POST', expected: [201], body: { role: actor.role, company: { name: actor.companyName, registrationNumber: actor.registrationNumber, country: 'NO' }, profile: { countries: ['NO'], sectors: ['Industrial materials'], summary: 'FICTIONAL local demonstration.' } } });
    user = (await client.request('/api/session')).data.user;
  }
  if (user.status !== 'active' || !['pending', 'approved'].includes(user.applicationStatus)) throw new DemoError(`The ${label} demo account was suspended or rejected. The launcher will not reactivate it or override an administrator decision.`);
  actor.userId = user.id; await save(record);
  return { client, actor, user };
}

async function prepareManagement(record, owner, environment) {
  const admin = new pg.Client({ connectionString: environment.DATABASE_ADMIN_URL, application_name: 'shadowbridge-local-demo-bootstrap' });
  try {
    await admin.connect();
    const result = await admin.query('SELECT id FROM auth.users WHERE id=$1 AND lower(email)=$2 AND email_confirmed_at IS NOT NULL', [owner.user.id, owner.actor.email]);
    if (result.rowCount !== 1) throw new DemoError('Verified local demo owner is required before management bootstrap.');
    // Same explicit, local DBA operation as bootstrap:admin. Approval itself
    // subsequently uses the real management API and live GoTrue AAL2 session.
    const grant=(await admin.query('SELECT active FROM sb.staff_grants WHERE user_id=$1',[owner.user.id])).rows[0];
    if(grant && !grant.active)throw new DemoError('The local demo management grant was revoked; it will not be reactivated.');
    if(!record.rbacBootstrapped){
      await admin.query('SELECT sb.bootstrap_owner($1::uuid)',[owner.user.id]);
      record.rbacBootstrapped=true; await save(record);
    }

  } finally { await admin.end(); }
  const factors = (await owner.client.request('/api/auth/factors')).data.factors;
  if (!record.mfa) {
    if (factors.length) throw new DemoError('Owner already has an authenticator not managed by this demo. No factor was removed.');
    const { data } = await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: [201] });
    if (!data.id || !data.totp?.secret) throw new DemoError('Real Auth did not return an authenticator.');
    record.mfa = { factorId: data.id, secret: data.totp.secret }; await save(record);
  } else if (!factors.some(factor => factor.id === record.mfa.factorId)) throw new DemoError('The stored demo MFA factor no longer exists; no factor was replaced.');
  let verified = await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: record.mfa.factorId, code: totp(record.mfa.secret) }, expected: [200, 400, 401, 403] });
  if (verified.status !== 200) {
    // TOTP codes cannot be replayed. A quick second start waits for a fresh code.
    await sleep(31000 - Date.now() % 30000);
    verified = await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: record.mfa.factorId, code: totp(record.mfa.secret) } });
  }
  const current = (await owner.client.request('/api/session')).data.user;
  if (!current.staff || current.aal !== 'aal2') throw new DemoError('Management bootstrap requires actual staff authorization and AAL2.');
}

async function prepareFixtures(record, actors) {
  const { owner, buyer, supplier, partner } = actors;
  const applications = (await owner.client.request('/api/admin/applications')).data.items;
  for (const role of ['buyer', 'supplier', 'partner']) {
    const actor = actors[role];
    const application = applications.find(item => item.userId === actor.user.id);
    if (!application) throw new DemoError(`The ${role} demo application was not found.`);
    if (application.status === 'pending') await owner.client.request(`/api/admin/applications/${application.id}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'FICTIONAL local demo approval performed through the management API with MFA.' } });
    else if (application.status !== 'approved') throw new DemoError('An administrator rejected a demo application; the launcher will not override that decision.');
    const user = (await actor.client.request('/api/session')).data.user;
    if (!user.roles.includes(role) || user.staff) throw new DemoError('Incorrect role isolation in the local fixture.');
    actor.actor.companyId = application.companyId;
  }
  await save(record);
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const catalogue=(await owner.client.request('/api/catalog')).data;
  const category=catalogue.categories.find(item=>item.key==='industrial-supplies' && !item.parentId);
  if(!category)throw new DemoError('Demo category is unavailable; existing data was preserved.');
  const categoryId=category.id;
  async function draft(kind, actor, fixture, data) {
    let item;
    if (record.fixtures[fixture]) item = (await actor.client.request(`/api/${kind}/${record.fixtures[fixture]}`)).data.item;
    else {
      item = (await actor.client.request(`/api/${kind}`, { method: 'POST', body: { data }, expected: [201] })).data.item;
      record.fixtures[fixture] = item.id; await save(record);
    }
    if (item.status === 'draft') await actor.client.request(`/api/${kind}/${item.id}/submit`, { method: 'POST', body: {} });
    return (await actor.client.request(`/api/${kind}/${item.id}`)).data.item;
  }
  const offer = await draft('offers', supplier, 'offer', { categoryId, productName: 'FICTIONAL recycled polymer granules', description: 'Local demonstration only. Not a real commercial offer.', specification: 'Fictional generic industrial polymer; illustrative technical specification.', countryOfOrigin: 'NO', quantity: 25, unit: 'tonne', price: 1250, currency: 'EUR', minimumOrderQuantity: 5, incoterms: 'FCA', deliveryTerms: 'Illustrative only; coordinated by ShadowBridge.', availability: 'By agreement', validUntil: future });
  await draft('rfqs', buyer, 'rfq', { categoryId, product: 'FICTIONAL industrial polymer purchase request', specifications: 'Local demonstration. Generic illustrative specification.', quantity: 10, unit: 'tonne', budget: 15000, currency: 'EUR', deliveryCountry: 'SE', deadline: future, requirements: 'All introductions and negotiations through ShadowBridge.' });
  await draft('proposals', partner, 'proposal', { title: 'FICTIONAL northern Europe introduction', description: 'Local test proposal for ShadowBridge screening.', countries: ['NO', 'SE'], sectors: ['Industrial materials'], scope: 'Illustrative introduction only; no real counterparties.' });
  // Only a newly submitted, namespaced fictional fixture is qualified by this
  // explicit local demo scenario. Existing approved/rejected records are preserved.
  if(offer.status==='submitted'){
    for(const stage of ['company','right_to_sell','documents_goods','decision'])await owner.client.request(`/api/staff/offers/${offer.id}/supplier-qualification`,{method:'POST',body:{stage,decision:'verified',sellerKind:'manufacturer',reason:'FICTIONAL local demonstration evidence reviewed by the demo owner.',evidenceReference:`FICTIONAL-${record.id.toUpperCase()}`}});
    await owner.client.request(`/api/staff/offers/${offer.id}/source-review`,{method:'POST',body:{sourceKind:'supplier_owned',reason:'FICTIONAL local demo product origin and sale authorization verified.'}});
  }
  if (offer.status === 'submitted') await owner.client.request(`/api/admin/offers/${offer.id}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional local demo source reviewed; identity remains internal.' } });
  if (!record.fixtures.opportunity) {
    const { data } = await owner.client.request('/api/admin/opportunities', { method: 'POST', expected: [201], body: { sourceOfferId: offer.id, commercial: { title: 'FICTIONAL screened industrial material', categoryId, specification: 'Reviewed generic demo specification. No supplier identity or direct contact is released.', quantity: 25, unit: 'tonne', price: 1250, currency: 'EUR', incoterms: 'FCA', availability: 'By agreement', validUntil: future }, reviewedNonIdentifying: true } });
    record.fixtures.opportunity = data.item.id; await save(record);
  }
  const cards = (await buyer.client.request('/api/opportunities')).data.items;
  if (!cards.some(item => item.id === record.fixtures.opportunity)) {
    if (record.fixtures.opportunityAssigned) throw new DemoError('The demo opportunity assignment was revoked; the launcher will not restore that permission automatically.');
    await owner.client.request(`/api/admin/opportunities/${record.fixtures.opportunity}/assign`, { method: 'POST', body: { recipientCompanyId: buyer.actor.companyId, role: 'buyer' } });
    record.fixtures.opportunityAssigned = true; await save(record);
  }
  if (!record.fixtures.project) {
    const { data } = await owner.client.request('/api/admin/projects', { method: 'POST', expected: [201], body: { partnerCompanyId: partner.actor.companyId, title: 'FICTIONAL screened cooperation project', summary: 'Illustrative local project. Introductions remain controlled by ShadowBridge.', reviewedNonIdentifying: true } });
    record.fixtures.project = data.item.id; await save(record);
  }
  const commissions = (await partner.client.request('/api/commissions')).data.items;
  if (!commissions.some(item => item.projectId === record.fixtures.project)) await owner.client.request('/api/admin/commissions', { method: 'POST', expected: [201], body: { projectId: record.fixtures.project, amount: 25, currency: 'EUR', agreementReference: `FICTIONAL-${record.id.toUpperCase()}`, agreementConfirmed: true, reviewedNonIdentifying: true } });
  // Verify that browser-facing commercial data omits the source mappings.
  const released = JSON.stringify((await buyer.client.request('/api/opportunities')).data);
  for (const secret of [supplier.actor.email, supplier.actor.companyName, supplier.actor.companyId, supplier.user.id, offer.id]) if (released.includes(secret)) throw new DemoError('Local confidentiality check failed.');
  for (const actor of [buyer, supplier, partner]) {
    const denied = await actor.client.request('/api/admin/companies', { expected: [403] });
    if (denied.status !== 403) throw new DemoError('Demo member unexpectedly has management access.');
  }
  const partnerCards = (await partner.client.request('/api/opportunities')).data.items;
  if (partnerCards.some(item => item.id === record.fixtures.opportunity)) throw new DemoError('An unassigned partner unexpectedly received the buyer opportunity.');
  for (const actor of Object.values(actors)) await actor.client.request('/api/auth/logout', { method: 'POST', body: {} });
  record.readyAt = new Date().toISOString(); await save(record);
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit' });
    child.once('error', () => reject(new DemoError('Could not start the local stack. Install Docker Compose and enable Docker for your user.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new DemoError('Local infrastructure startup failed. No cloud service was created.')));
  });
}

async function main() {
  const command = process.argv[2] || 'start';
  if (!['start', 'accounts', 'code'].includes(command)) throw new DemoError('Usage: npm run demo | npm run demo:accounts | npm run demo:code');
  if (command !== 'start') {
    // Credentials/codes must be requested explicitly in the owner's terminal,
    // never silently copied into CI output, tools, screenshots or application UI.
    if (!process.stdout.isTTY || !process.stdin.isTTY) throw new DemoError('Run this command directly in your own interactive terminal; credentials are not printed into redirected logs.');
    requireLocal(await localEnvironment());
    const record = await readAccounts();
    if (!record.readyAt) throw new DemoError('The demo setup has not completed; run npm run demo first.');
    if (command === 'accounts') {
      console.log('LOKALNE KONTA FIKCYJNE — nie publikuj tych danych ani pliku .local/demo-accounts.json.');
      for (const label of roles) console.log(`${label.toUpperCase()}\n  E-mail: ${record.actors[label].email}\n  Hasło: ${record.actors[label].password}`);
      console.log('Administrator: po zalogowaniu otwórz /portal/admin/ i uruchom npm run demo:code w drugim terminalu.');
    } else console.log(`Kod MFA lokalnego administratora: ${totp(record.mfa.secret)} (ważny jeszcze ${30 - Math.floor(Date.now() / 1000) % 30} s).`);
    return;
  }
  // Do not contact an existing process or generate fixture credentials when the
  // expected port belongs to an unknown/stale application. The real bind below
  // also checks again after infrastructure startup.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new DemoError('Port 8088 jest zajęty. Zatrzymaj poprzednie npm run dev:server lub npm run demo (Ctrl+C) i ponów. Żaden obcy proces nie został zatrzymany.')));
    probe.listen(8088, '127.0.0.1', () => probe.close(resolve));
  });
  await ensureEnvironment();
  const environment = await localEnvironment(); requireLocal(environment);
  console.log('Uruchamianie wyłącznie lokalnego MVP. Powstaną fikcyjne konta, ich weryfikacje e-mail i decyzje administracyjne demonstracji.');
  await run(process.execPath, ['scripts/dev-up.mjs'], environment);
  const { loadConfig } = await import('../server/config.mjs');
  const { createApp } = await import('../server/app.mjs');
  const app = createApp({ config: loadConfig(environment) });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true; await app.close();
  };
  try {
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(8088, '127.0.0.1', resolve); });
  } catch (error) {
    await app.db.close();
    if (error.code === 'EADDRINUSE') throw new DemoError('Port 8088 jest zajęty. Zatrzymaj poprzednie npm run dev:server lub npm run demo (Ctrl+C) i ponów. Demo nie wysyła haseł do niezweryfikowanego serwera.');
    throw new DemoError('Nie można uruchomić lokalnego serwera na 127.0.0.1:8088.');
  }
  const interrupted = async () => { await close(); console.log('\nAplikacja zatrzymana; konta i baza zachowane. Kontenery zatrzymasz przez npm run dev:down.'); process.exit(0); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    const record = await loadOrCreateAccounts();
    const actors = {};
    for (const label of roles) { actors[label] = await prepareActor(record, label); console.log(`Konto fikcyjne ${label.toUpperCase()}: adres potwierdzony przez rzeczywisty lokalny Auth.`); }
    await prepareManagement(record, actors.owner, environment);
    await prepareFixtures(record, actors);
    console.log('\nMVP gotowy: http://127.0.0.1:8088/');
    console.log('Logowanie: http://127.0.0.1:8088/member-sign-in/ | Poczta testowa: http://127.0.0.1:8025/');
    console.log('Buyer, Supplier i Partner są zatwierdzeni; baza zawiera fikcyjną ofertę, RFQ, anonimową okazję i projekt.');
    console.log('W drugim terminalu: npm run demo:accounts — pokaż własne losowe dane logowania.');
    console.log('Dla administratora: npm run demo:code — bieżący kod drugiego składnika. Nie udostępniaj pliku .local/demo-accounts.json.');
    console.log('Ctrl+C zatrzymuje tylko tę aplikację. Nic nie wdrożono na produkcję.');
  } catch (error) {
    await close(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  // Never print provider responses, URLs, tokens, SQL or arbitrary exception bodies.
  const safe = error instanceof DemoError ? error.message : 'Local demo startup failed; existing data and credentials were preserved. Check Docker and Node prerequisites; no exception details or secrets were logged.';
  console.error(safe); process.exitCode = 1;
});
