import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const appOrigin = process.env.SHADOWBRIDGE_TEST_URL || 'http://127.0.0.1:8088';
export const mailOrigin = process.env.SHADOWBRIDGE_MAILPIT_URL || 'http://127.0.0.1:8025';
export const runId = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

// Test credentials exist only in memory. Do not log request/response bodies here.
export function password() { return `Sb!${randomBytes(24).toString('base64url')}9a`; }
export function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
export function db(sql) {
  const container = process.env.SHADOWBRIDGE_DB_CONTAINER || execFileSync('docker', [
    'ps', '--filter', 'label=com.docker.compose.project=shadowbridge-private-local',
    '--filter', 'label=com.docker.compose.service=postgres', '--format', '{{.ID}}',
  ], { encoding: 'utf8' }).trim();
  if (!container) throw new Error('Local PostgreSQL container is not running; run the documented local stack first');
  try {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', process.env.SHADOWBRIDGE_TEST_DATABASE || 'shadowbridge'], {
      input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    // SQL failures can contain confidential fixture fields. Report SQLSTATE only.
    const code = String(error.stderr || '').match(/(?:ERROR:|SQLSTATE:)[^\n]*/)?.[0] || 'database command failed';
    throw new Error(`Test database operation failed (${code.replace(/"[^\"]*"|'[^']*'/g, '[redacted]')})`);
  }
}

export class Client {
  constructor() { this.cookies = new Map(); this.csrf = null; this.lastCookieHeaders = []; }
  cookieHeader() { return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '); }
  async request(path, { method = 'GET', body, csrf = true, origin = appOrigin, expected } = {}) {
    if (method !== 'GET' && csrf && !this.csrf) await this.request('/api/config');
    const headers = { Accept: 'application/json' };
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    if (method !== 'GET') {
      headers.Origin = origin;
      headers['Content-Type'] = 'application/json';
      if (csrf && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    }
    const response = await fetch(new URL(path, appOrigin), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
    });
    this.lastCookieHeaders = response.headers.getSetCookie();
    for (const raw of this.lastCookieHeaders) {
      const match = /^([^=;]+)=([^;]*)/.exec(raw);
      if (match) {
        if (/max-age=0(?:;|$)/i.test(raw)) this.cookies.delete(match[1]);
        else this.cookies.set(match[1], match[2]);
      }
    }
    let data = null;
    if (response.headers.get('content-type')?.includes('application/json')) data = await response.json();
    else await response.arrayBuffer();
    if (data?.csrfToken) this.csrf = data.csrfToken;
    if (expected !== undefined) {
      const statuses = Array.isArray(expected) ? expected : [expected];
      assert.ok(statuses.includes(response.status), `${method} ${path.split('?')[0]} returned HTTP ${response.status}; expected ${statuses.join('/')}`);
    }
    return { status: response.status, data, headers: response.headers };
  }
  async signIn(actor) {
    await this.request('/api/config', { expected: 200 });
    const response = await this.request('/api/auth/login', { method: 'POST', body: { email: actor.email, password: actor.password }, expected: 200 });
    const session = await this.request('/api/session', { expected: 200 });
    return { ...response, session: session.data };
  }
}

export async function waitForMessage(email, { after = 0, timeout = 25_000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const response = await fetch(`${mailOrigin}/api/v1/messages`);
    assert.equal(response.status, 200, 'Local Mailpit must be running; no external e-mail service is used');
    const data = await response.json();
    const messages = data.messages || data.Messages || [];
    const match = messages.find(message => {
      const recipients = message.To || message.to || [];
      return recipients.some(recipient => (recipient.Address || recipient.address || '').toLowerCase() === email.toLowerCase())
        && (!after || Date.parse(message.Created || message.created || 0) >= after);
    });
    if (match) {
      const detail = await fetch(`${mailOrigin}/api/v1/message/${encodeURIComponent(match.ID || match.id)}`);
      assert.equal(detail.status, 200, 'Mailpit message must be retrievable');
      return detail.json();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error('Expected local verification/recovery e-mail was not received');
}

export function confirmationLink(message) {
  const content = [message.HTML, message.Text, message.html, message.text].filter(Boolean).join('\n').replaceAll('&amp;', '&');
  const links = content.match(/https?:\/\/[^\s<>"']+/g) || [];
  const link = links.find(value => /\/auth\/(confirm|recover)|\/verify\?/.test(value));
  assert.ok(link, 'Real Auth e-mail must contain its verification/recovery URL');
  const url = new URL(link);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Verification/recovery must remain local');
  return url;
}

export async function confirmMessage(client, message) {
  let url = confirmationLink(message);
  // GoTrue may issue its own verify URL. Follow only loopback redirects.
  for (let count = 0; count < 8; count++) {
    const sameBff = url.origin === appOrigin;
    if (sameBff) {
      const result = await client.request(`${url.pathname}${url.search}`, { expected: [200, 302, 303] });
      const next = result.headers.get('location');
      if (!next) return result;
      url = new URL(next, url);
    } else {
      const response = await fetch(url, { redirect: 'manual' });
      assert.ok([200, 302, 303].includes(response.status), `Real Auth link returned HTTP ${response.status}`);
      const next = response.headers.get('location');
      if (!next) return { status: response.status, headers: response.headers };
      url = new URL(next, url);
    }
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'E-mail flow must not contact an external service');
    // The application return page is not another identity exchange.
    if (url.origin === appOrigin && !/^\/auth\/(confirm|recover)/.test(url.pathname)) return { status: 303, headers: new Headers({ Location: url.href }) };
  }
  throw new Error('Verification redirect loop');
}

export function totp(secret, timestamp = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/[=\s-]/g, '')) {
    const index = alphabet.indexOf(char);
    assert.ok(index >= 0, 'Auth provider must return a valid TOTP enrollment secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function registerActor(role, label = role) {
  const client = new Client();
  const actor = {
    role, email: `${runId}.${label}@test.shadowbridge.invalid`, password: password(),
    companyName: `FICTIONAL ${runId} ${label} Ltd`, registrationNumber: `DEMO-${runId}-${label}`,
    client,
  };
  await client.request('/api/auth/register', { method: 'POST', body: {
    email: actor.email, password: actor.password, role,
    company: { name: actor.companyName, registrationNumber: actor.registrationNumber, country: 'NO' },
    profile: { countries: ['NO'], sectors: ['Industrial materials'], summary: 'Fictional local automated security test; no real business data.' },
  }, expected: 202 });
  return actor;
}

export async function verifyActor(actor) {
  await confirmMessage(actor.client, await waitForMessage(actor.email));
  const { session } = await actor.client.signIn(actor);
  assert.equal(session.user.emailVerified, true, 'E-mail must be verified by real Auth before continuing');
  actor.user = session.user;
  return actor;
}

export function assertNoCounterpartySecrets(value, forbidden) {
  const raw = JSON.stringify(value).toLowerCase();
  for (const secret of forbidden.filter(Boolean)) assert.ok(!raw.includes(String(secret).toLowerCase()), 'Buyer response leaked a counterparty identifying value');
  const forbiddenKeys = /^(company_?id|supplier_?id|buyer_?id|source_?offer_?id|crm_?id|email|phone|website|registration_?number|company_?name|supplier|buyer|internal_?id)$/i;
  const walk = current => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      assert.ok(!forbiddenKeys.test(key), `Anonymous offer DTO contains forbidden identifying key: ${key}`);
      walk(child);
    }
  };
  walk(value);
}
