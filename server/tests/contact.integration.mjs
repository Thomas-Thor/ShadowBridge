import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  appOrigin, Client, db, runId, sqlLiteral, registerActor, verifyActor, totp,
} from './helpers.mjs';

// Use an actual, separate loopback source address: rate-limit tests must not
// reset somebody else's bucket or trust a browser-supplied forwarding header.
const addressBytes = randomBytes(3);
const localAddress = `127.${1 + addressBytes[0] % 253}.${1 + addressBytes[1] % 253}.${1 + addressBytes[2] % 253}`;
const fixture = {
  name: `FICTIONAL ${runId} contact`, email: `${runId}.contact@test.shadowbridge.invalid`,
  company: `FICTIONAL ${runId} contact company`, role: 'buyer',
  message: `FICTIONAL local queue test ${runId}; <img src=x onerror="window.contactInjection=true">. No real confidential data.`,
  consent: true, website: '',
};

function contactRequest(client, body, { csrf = true, origin = appOrigin, headers = {} } = {}) {
  const url = new URL('/api/contact', appOrigin);
  assert.equal(url.protocol, 'http:', 'Integration fixtures must use the documented local HTTP stack');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Do not submit test contact records to a public server');
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(url, {
      method: 'POST', localAddress,
      headers: {
        Accept: 'application/json', Origin: origin, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload), Cookie: client.cookieHeader(),
        ...(csrf ? { 'X-CSRF-Token': client.csrf } : {}), ...headers,
      },
    }, response => {
      const parts = [];
      response.on('data', chunk => parts.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
        catch { reject(new Error(`Contact response was not JSON (HTTP ${response.statusCode})`)); }
      });
    });
    request.setTimeout(15_000, () => request.destroy(new Error('Local contact request timed out')));
    request.on('error', reject);
    request.end(payload);
  });
}

function restricted(actor, sql, aal = 'aal1') {
  return db(`BEGIN; SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${sqlLiteral(actor.user.id)},true); SELECT set_config('request.jwt.claim.aal',${sqlLiteral(aal)},true); ${sql}; ROLLBACK;`);
}

test('Contact queue: real PostgreSQL persistence, management-only access and durable rate limits', { timeout: 180_000 }, async t => {
  const anonymous = new Client();
  const configuration = await anonymous.request('/api/config', { expected: 200 });
  assert.equal(configuration.data.backendEnabled, true, 'Run the real GoTrue/PostgreSQL/Mailpit/BFF stack; this suite has no mocks');
  let receipt, owner, buyer, supplier;

  await t.test('origin, CSRF, explicit consent and input validation precede persistence', async () => {
    assert.equal((await contactRequest(anonymous, fixture, { csrf: false })).status, 403);
    assert.equal((await contactRequest(anonymous, fixture, { origin: 'https://untrusted.invalid' })).status, 403);
    for (const invalid of [
      { consent: false }, { consent: 'true' }, { email: 'invalid-email' },
      { role: 'admin' }, { message: 'too short' }, { message: 'x'.repeat(5001) },
      { website: 'https://honeypot.invalid' }, { confidentialCompanyId: 'not-accepted' },
    ]) {
      const result = await contactRequest(anonymous, { ...fixture, ...invalid });
      assert.ok([400, 422].includes(result.status), 'Invalid public intake must be rejected without a queue entry');
    }
    assert.equal(db(`SELECT count(*) FROM sb.contact_enquiries WHERE email=${sqlLiteral(fixture.email)}`), '0');
  });

  await t.test('public submit commits a real intake and returns only a receipt, never private fields', async () => {
    const result = await contactRequest(anonymous, fixture);
    assert.equal(result.status, 201);
    assert.equal(result.data.accepted, true);
    assert.match(result.data.receipt, /^SB-CONTACT-[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(result.data).sort(), ['accepted', 'message', 'receipt']);
    receipt = result.data.receipt;
    for (const value of [fixture.name, fixture.email, fixture.company, fixture.message]) {
      assert.ok(!JSON.stringify(result.data).includes(value), 'Public response must not echo identifying enquiry fields');
    }
    const persisted = JSON.parse(db(`SELECT json_build_object('email',email,'message',message,'status',status) FROM sb.contact_enquiries WHERE public_id=${sqlLiteral(receipt)}`));
    assert.deepEqual(persisted, { email: fixture.email, message: fixture.message, status: 'new' });
    await anonymous.request('/api/admin/contact-queue', { expected: 401 });
    await anonymous.request(`/api/admin/contact-queue/${receipt}/status`, { method: 'POST', body: { status: 'closed' }, expected: 401 });
  });

  await t.test('approved buyers/suppliers and management without MFA cannot read the queue', async () => {
    owner = await verifyActor(await registerActor('partner', 'contact-owner'));
    buyer = await verifyActor(await registerActor('buyer', 'contact-buyer'));
    supplier = await verifyActor(await registerActor('supplier', 'contact-supplier'));
    db(`INSERT INTO sb.staff_grants(user_id,active) VALUES(${sqlLiteral(owner.user.id)},true)`);
    const lowAssurance = new Client();
    await lowAssurance.signIn(owner);
    await lowAssurance.request('/api/admin/contact-queue', { expected: 403 });
    const factor = (await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: 201 })).data;
    await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: factor.id, code: totp(factor.totp.secret) }, expected: 200 });
    for (const actor of [buyer, supplier]) {
      const application = db(`SELECT id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)}`);
      await owner.client.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'FICTIONAL local contact permissions test' }, expected: 200 });
      await actor.client.request('/api/admin/contact-queue', { expected: 403 });
      await actor.client.request(`/api/admin/contact-queue/${receipt}/status`, { method: 'POST', body: { status: 'closed' }, expected: 403 });
      assert.equal(restricted(actor, `SELECT count(*) FROM sb.contact_enquiries WHERE public_id=${sqlLiteral(receipt)}`).split('\n').at(-1), '0', 'RLS must hide contact identities from normal approved members');
    }
    assert.equal(restricted(owner, `SELECT count(*) FROM sb.contact_enquiries WHERE public_id=${sqlLiteral(receipt)}`).split('\n').at(-1), '0', 'Management AAL1 must also be excluded by the database policy');
    assert.throws(() => db('BEGIN; SET LOCAL ROLE shadowbridge_sessions; SELECT count(*) FROM sb.contact_enquiries; ROLLBACK;'), /database operation failed/i);
    assert.equal(db("SELECT has_function_privilege('shadowbridge_api','sb.enqueue_contact(jsonb,text)','EXECUTE')::text"), 'false');
    assert.equal(db("SELECT has_function_privilege('shadowbridge_sessions','sb.enqueue_contact(jsonb,text)','EXECUTE')::text"), 'true');
  });

  await t.test('MFA-authorized management processes immutable intake with durable, content-free audit', async () => {
    const list = await owner.client.request('/api/admin/contact-queue', { expected: 200 });
    const item = list.data.items.find(record => record.id === receipt);
    assert.ok(item, 'Committed enquiry must appear in the actual management queue');
    assert.equal(item.message, fixture.message);
    assert.equal(item.email, fixture.email);
    await owner.client.request(`/api/admin/contact-queue/${receipt}/status`, { method: 'POST', body: { status: 'in_review' }, expected: 200 });
    const persisted = JSON.parse(db(`SELECT json_build_object('status',status,'processedBy',processed_by,'reviewed',reviewed_at IS NOT NULL) FROM sb.contact_enquiries WHERE public_id=${sqlLiteral(receipt)}`));
    assert.deepEqual(persisted, { status: 'in_review', processedBy: owner.user.id, reviewed: true });
    await owner.client.request(`/api/admin/contact-queue/${receipt}/status`, { method: 'POST', body: { status: 'approved' }, expected: 400 });
    await owner.client.request(`/api/admin/contact-queue/${receipt}/status`, { method: 'POST', body: { status: 'closed', email: 'replacement@test.shadowbridge.invalid' }, expected: 400 });
    const audit = JSON.parse(db(`SELECT coalesce(json_agg(json_build_object('actor',actor_id,'metadata',metadata)),'[]') FROM sb.audit_events WHERE resource='sb.contact_enquiries' AND resource_id=(SELECT id::text FROM sb.contact_enquiries WHERE public_id=${sqlLiteral(receipt)})`));
    assert.ok(audit.some(event => event.actor === owner.user.id && event.metadata.status === 'in_review'));
    const logged = JSON.stringify(audit);
    for (const value of [fixture.message, fixture.email, fixture.name]) assert.ok(!logged.includes(value), 'Audit must record IDs/status/actor, never contact message contents');
  });

  await t.test('five accepted submissions exhaust the actual source-IP bucket; forged proxy headers do not bypass it', async () => {
    for (let count = 1; count < 5; count++) {
      const result = await contactRequest(anonymous, { ...fixture, message: `${fixture.message} Copy ${count}.` });
      assert.equal(result.status, 201);
    }
    assert.equal(db(`SELECT count(*) FROM sb.contact_enquiries WHERE email=${sqlLiteral(fixture.email)}`), '5');
    const blocked = await contactRequest(anonymous, fixture, {
      headers: { 'X-Forwarded-For': '203.0.113.24', 'CF-Connecting-IP': '203.0.113.25', 'X-Real-IP': '203.0.113.26' },
    });
    assert.equal(blocked.status, 429, 'Only the real socket source address may determine the local intake limit');
    assert.equal(db(`SELECT count(*) FROM sb.contact_enquiries WHERE email=${sqlLiteral(fixture.email)}`), '5', 'Rejected intake must not be inserted');
  });
});
