import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appOrigin, Client, runId, password, db, sqlLiteral, registerActor, verifyActor,
  waitForMessage, confirmMessage, totp, bootstrapOwner, catalogCategory,
} from './helpers.mjs';

// Real local GoTrue + PostgreSQL + Mailpit. A shared Map models browser cookies;
// separate csrf properties model the in-memory state of two open tabs.
async function boundRequest(client, path, token, { method = 'GET', body } = {}) {
  const response = await fetch(new URL(path, appOrigin), {
    method, redirect: 'manual', headers: {
      Accept: 'application/json', Cookie: client.cookieHeader(), 'X-Session-Token': token,
      ...(method === 'GET' ? {} : { Origin: appOrigin, 'Content-Type': 'application/json', 'X-CSRF-Token': token }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

let category;
const draft = label => ({ data: { ...category, product: `FICTIONAL session regression ${runId} ${label}` } });
const applicationFor = actor => db(`SELECT id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)} ORDER BY created_at LIMIT 1`);
const countRFQs = actor => Number(db(`SELECT count(*) FROM sb.rfqs WHERE company_id=(SELECT company_id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)} ORDER BY created_at LIMIT 1)`));

test('Session safety with real authentication and shared browser cookies', { timeout: 180_000 }, async t => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(appOrigin).hostname), 'Session fixtures must remain local');
  category = await catalogCategory(new Client());
  let owner, buyerA, buyerB, sharedA, sharedB, oldAToken;

  await t.test('opening another tab preserves CSRF while cross-origin and missing-token writes stay blocked', async () => {
    const tabA = new Client();
    const initial = await tabA.request('/api/config', { expected: 200 });
    assert.equal(initial.data.backendEnabled, true, 'A working backend is required, not static HTML');
    const tabB = new Client(); tabB.cookies = tabA.cookies;
    const [configuration, session] = await Promise.all([
      tabB.request('/api/config', { expected: 200 }), tabA.request('/api/session', { expected: 200 }),
    ]);
    assert.equal(configuration.data.csrfToken, initial.data.csrfToken, 'A second tab must not invalidate the first tab token');
    assert.equal(session.data.csrfToken, initial.data.csrfToken, 'Session checks must not rotate CSRF unnecessarily');
    await tabA.request('/api/auth/logout', { method: 'POST', body: {}, csrf: false, expected: 403 });
    await tabA.request('/api/auth/logout', { method: 'POST', body: {}, origin: 'https://foreign.invalid', expected: 403 });
    const cleared = await tabA.request('/api/auth/logout', { method: 'POST', body: {}, expected: 200 });
    assert.equal(cleared.data.signedOut, true, 'Anonymous sign-out is safe and idempotent');
    assert.ok(tabA.lastCookieHeaders.some(value => /^(?:__Host-)?sb_session=/.test(value) && /max-age=0/i.test(value)), 'Sign-out clears a stale session cookie even without a valid identity');
  });

  await t.test('verified fictional companies need real manual approval and owner TOTP', async () => {
    buyerA = await verifyActor(await registerActor('buyer', 'session-buyer-a'));
    buyerB = await verifyActor(await registerActor('buyer', 'session-buyer-b'));
    owner = await verifyActor(await registerActor('partner', 'session-owner'));
    bootstrapOwner(owner);
    const application = applicationFor(buyerA);
    await owner.client.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Must be rejected before MFA' }, expected: 403 });
    const factor = await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: 201 });
    await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: factor.data.id, code: totp(factor.data.totp.secret) }, expected: 200 });
    assert.equal((await owner.client.request('/api/session', { expected: 200 })).data.user.aal, 'aal2');
    for (const actor of [buyerA, buyerB]) {
      await owner.client.request(`/api/admin/applications/${applicationFor(actor)}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional session regression; real local email proof and manual approval' }, expected: 200 });
    }
  });

  await t.test('switching a shared browser to another company blocks stale reads, writes and sign-out', async () => {
    sharedA = new Client(); await sharedA.signIn(buyerA);
    sharedB = new Client(); sharedB.cookies = sharedA.cookies;
    await sharedB.request('/api/session', { expected: 200 });
    oldAToken = sharedA.csrf;
    assert.equal(sharedB.csrf, oldAToken);
    const replacedCookie = new Client();
    replacedCookie.cookies = new Map(sharedA.cookies); replacedCookie.csrf = oldAToken;
    await sharedA.request('/api/rfqs', { method: 'POST', body: draft('company-A-only'), expected: 201 });
    const beforeA = countRFQs(buyerA), beforeB = countRFQs(buyerB);
    await sharedB.signIn(buyerB);
    assert.notEqual(sharedB.csrf, oldAToken, 'Changing identity changes its request binding');
    assert.equal((await replacedCookie.request('/api/session', { expected: 200 })).data.user, null, 'Replacing browser identity revokes the previous opaque BFF session');
    await sharedA.request('/api/rfqs', { method: 'POST', body: draft('must-not-be-saved-as-B'), expected: 403 });
    const staleGet = await boundRequest(sharedA, '/api/rfqs', oldAToken);
    assert.equal(staleGet.status, 409, 'Old tab identity binding must block a new-account response');
    assert.equal(staleGet.data.code, 'session_changed');
    assert.ok(!Object.hasOwn(staleGet.data, 'items'), 'A rejected stale read returns no private records');
    assert.equal((await boundRequest(sharedA, '/api/rfqs', oldAToken, { method: 'POST', body: draft('bound-write-rejected') })).status, 409);
    await sharedA.request('/api/auth/logout', { method: 'POST', body: {}, expected: 403 });
    assert.equal((await boundRequest(sharedA, '/api/auth/logout', oldAToken, { method: 'POST', body: {} })).status, 409);
    assert.equal(countRFQs(buyerA), beforeA, 'Rejected actions do not mutate the previous company');
    assert.equal(countRFQs(buyerB), beforeB, 'Rejected actions never execute as the replacement company');
    const current = await sharedB.request('/api/session', { expected: 200 });
    assert.equal(current.data.user.id, buyerB.user.id, 'Stale-tab logout must not sign out the current account');
    assert.deepEqual((await sharedB.request('/api/rfqs', { expected: 200 })).data.items, []);
    await sharedB.request('/api/auth/logout', { method: 'POST', body: {}, expected: 200 });
    assert.equal((await sharedA.request('/api/session', { expected: 200 })).data.user, null);
    await sharedA.request('/api/rfqs', { expected: 401 });
  });

  await t.test('separate browser profiles keep independent sessions; suspension blocks an existing profile', async () => {
    const profileA = new Client(), profileB = new Client();
    await profileA.signIn(buyerA); await profileB.signIn(buyerB);
    await profileA.request('/api/auth/logout', { method: 'POST', body: {}, expected: 200 });
    assert.equal((await profileB.request('/api/session', { expected: 200 })).data.user.id, buyerB.user.id);
    await profileA.request('/api/rfqs', { expected: 401 });
    await owner.client.request(`/api/admin/accounts/${buyerB.user.id}/status`, { method: 'POST', body: { status: 'suspended' }, expected: 200 });
    await profileB.request('/api/rfqs', { expected: 401 });
    await owner.client.request(`/api/admin/accounts/${buyerB.user.id}/status`, { method: 'POST', body: { status: 'active' }, expected: 200 });
    assert.equal((await profileB.request('/api/session', { expected: 200 })).data.user, null, 'Reactivation must not resurrect a session revoked by suspension');
    const newSession = new Client(); await newSession.signIn(buyerB);
    assert.equal((await newSession.request('/api/session', { expected: 200 })).data.user.id, buyerB.user.id);
  });

  await t.test('real recovery is restricted, resets the password and revokes every existing BFF session', async () => {
    const existingA = new Client(), existingB = new Client(), recovery = new Client();
    await existingA.signIn(buyerA); await existingB.signIn(buyerA);
    const since = Date.now() - 1000;
    await recovery.request('/api/auth/recover', { method: 'POST', body: { email: buyerA.email }, expected: 202 });
    const preRecoveryCsrf = recovery.csrf;
    await confirmMessage(recovery, await waitForMessage(buyerA.email, { after: since }));
    const staleRecovery = new Client(); staleRecovery.cookies = recovery.cookies; staleRecovery.csrf = preRecoveryCsrf;
    await staleRecovery.request('/api/auth/password', { method: 'POST', body: { password: password() }, expected: 403 });
    const restricted = await recovery.request('/api/session', { expected: 200 });
    assert.equal(restricted.data.user.recoveryOnly, true);
    await recovery.request('/api/rfqs', { expected: 403 });
    await recovery.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: 403 });
    const replacement = password();
    await recovery.request('/api/auth/password', { method: 'POST', body: { password: replacement }, expected: 200 });
    for (const oldSession of [existingA, existingB, recovery]) {
      assert.equal((await oldSession.request('/api/session', { expected: 200 })).data.user, null, 'Password reset invalidates every old BFF cookie');
      await oldSession.request('/api/rfqs', { expected: 401 });
    }
    const oldPassword = new Client();
    await oldPassword.request('/api/auth/login', { method: 'POST', body: { email: buyerA.email, password: buyerA.password }, expected: 401 });
    const replacementSession = new Client();
    await replacementSession.signIn({ ...buyerA, password: replacement });
    assert.equal((await replacementSession.request('/api/session', { expected: 200 })).data.user.id, buyerA.user.id);
  });
});
