import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  appOrigin, Client, runId, password, db, sqlLiteral, registerActor, verifyActor,
  waitForMessage, confirmMessage, totp, assertNoCounterpartySecrets,
} from './helpers.mjs';

// These are destructive only to the uniquely named fictional records created by
// this run. They never replace Auth, PostgreSQL, RLS or the application with mocks.
// Retain audit evidence in the disposable local database; never reset shared data.
const future = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
const offerData = {
  category: 'Industrial materials', productName: 'Fictional recycled industrial polymer',
  description: 'Fictional laboratory-only product specification.', specification: 'Non-hazardous test granules; not a real commercial offer.',
  countryOfOrigin: 'NO', quantity: '20', unit: 'tonne', price: '1250', currency: 'EUR',
  minimumOrderQuantity: '5', incoterms: 'FCA', loadingLocation: 'NO', deliveryTerms: 'Collection by appointment',
  availability: 'Within 30 days', validUntil: future, certificationsStatus: 'Manual review required',
  notes: 'Fictional security integration test only.',
};
const rfqData = {
  product: 'Fictional industrial polymer', specifications: 'Test material; no real procurement.',
  quantity: '10', unit: 'tonne', budget: '14000', currency: 'EUR', deliveryCountry: 'NO',
  deadline: future, certificates: 'Review by ShadowBridge', requirements: 'Fictional test buyer requirement.',
};

function expectDenied(result, context) {
  assert.ok([401, 403, 404].includes(result.status), `${context} must be denied; received HTTP ${result.status}`);
}
function companyFor(actor) {
  return db(`SELECT company_id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)} ORDER BY created_at LIMIT 1`);
}
function applicationFor(actor) {
  return db(`SELECT id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)} ORDER BY created_at LIMIT 1`);
}
function restricted(actor, sql, aal = 'aal1') {
  return db(`BEGIN; SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${sqlLiteral(actor.user.id)},true); SELECT set_config('request.jwt.claim.aal',${sqlLiteral(aal)},true); ${sql}; ROLLBACK;`);
}

test('Private B2B: real local Auth, PostgreSQL, RLS and counterparty confidentiality', { timeout: 300_000 }, async t => {
  const health = await fetch(new URL('/api/config', appOrigin));
  assert.equal(health.status, 200, 'Start the documented local stack and BFF before running integration tests');
  assert.equal((await health.json()).backendEnabled, true, 'This suite requires the running backend, never the disabled static UI');

  let buyerA, buyerB, supplier, partner, owner, ownerAal1, offer, rfq, opportunity;
  async function step(name, fn) {
    await t.test(name, fn);
  }

  await step('anonymous requests cannot fetch private data, server source, local secrets or review files', async () => {
    const anonymous = new Client();
    const configuration = await anonymous.request('/api/config', { expected: 200 });
    assert.deepEqual(Object.keys(configuration.data).sort(), ['backendEnabled', 'csrfToken', 'environment']);
    for (const path of ['/api/offers', '/api/rfqs', '/api/opportunities', '/api/admin/companies']) {
      await anonymous.request(path, { expected: 401 });
    }
    for (const path of ['/server/app.mjs', '/.local/development.env', '/local/compose.yaml', '/docs/architecture.md', '/review/buyer-desktop.png', '/supabase/migrations/202610180001_private_b2b.sql']) {
      await anonymous.request(path, { expected: 404 });
    }
    const restrictedPage = await fetch(new URL('/cartel/', appOrigin));
    assert.equal(restrictedPage.status, 200);
    assert.match(await restrictedPage.text(), /invitation.only|restricted.access/i, 'Existing C.A.R.T.E.L. restriction must be preserved');
    assert.match(configuration.headers.get('x-robots-tag') || '', /noindex/i);
    assert.match(configuration.headers.get('content-security-policy') || '', /frame-ancestors 'none'/i);
  });

  await step('unverified accounts cannot sign in; self-appointed administrator role is rejected', async () => {
    buyerA = await registerActor('buyer', 'buyer-a');
    await buyerA.client.request('/api/auth/login', { method: 'POST', body: { email: buyerA.email, password: buyerA.password }, expected: [400, 401, 403] });
    const beforeDuplicate = db(`SELECT md5(raw_user_meta_data::text) FROM auth.users WHERE email=${sqlLiteral(buyerA.email)}`);
    const duplicate = new Client();
    await duplicate.request('/api/auth/register', { method: 'POST', body: {
      email: buyerA.email, password: password(), role: 'supplier',
      company: { name: 'FICTIONAL ATTACKER REPLACEMENT', registrationNumber: `ATTACK-${runId}`, country: 'US' },
      profile: { summary: 'This must never replace the existing applicant profile.' },
    }, expected: [202, 409, 429] });
    assert.equal(db(`SELECT md5(raw_user_meta_data::text) FROM auth.users WHERE email=${sqlLiteral(buyerA.email)}`), beforeDuplicate, 'Unauthenticated duplicate registration must not modify an existing Auth identity or deferred application');
    const attacker = new Client();
    await attacker.request('/api/auth/register', { method: 'POST', body: {
      email: `${runId}.self-admin@test.shadowbridge.invalid`, password: password(), role: 'admin',
      company: { name: 'Fictional self promotion attempt', registrationNumber: runId, country: 'NO' },
    }, expected: [400, 422] });
    await verifyActor(buyerA);
    assert.equal(buyerA.user.staff, false);
    assert.ok(!buyerA.user.roles?.includes('admin'));
    assert.equal(buyerA.user.company.name, buyerA.companyName, 'Duplicate registration cannot replace the original business application');
  });

  await step('real verification e-mails create pending accounts without private access', async () => {
    buyerB = await verifyActor(await registerActor('buyer', 'buyer-b'));
    supplier = await verifyActor(await registerActor('supplier', 'supplier'));
    partner = await verifyActor(await registerActor('partner', 'partner'));
    owner = await verifyActor(await registerActor('partner', 'owner'));
    for (const actor of [buyerA, buyerB, supplier, partner]) {
      const current = await actor.client.request('/api/session', { expected: 200 });
      assert.equal(current.data.user.applicationStatus, 'pending');
      const privateData = await actor.client.request('/api/opportunities');
      assert.ok([200, 403].includes(privateData.status));
      if (privateData.status === 200) assert.deepEqual(privateData.data.items, []);
      expectDenied(await actor.client.request('/api/admin/applications'), 'Pending account management access');
    }
    await supplier.client.request('/api/offers', { method: 'POST', body: { data: offerData }, expected: 403 });
    await buyerA.client.request('/api/rfqs', { method: 'POST', body: { data: rfqData }, expected: 403 });
  });

  await step('management requires a real TOTP factor and AAL2; AAL1 cannot approve', async () => {
    db(`INSERT INTO sb.staff_grants(user_id,active) VALUES(${sqlLiteral(owner.user.id)},true) ON CONFLICT(user_id) DO UPDATE SET active=true`);
    ownerAal1 = new Client();
    await ownerAal1.signIn(owner);
    const application = applicationFor(buyerA);
    await ownerAal1.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Must fail without MFA' }, expected: 403 });
    const enrolled = await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: [200, 201] });
    const factor = enrolled.data;
    assert.ok(factor.id && factor.totp?.secret, 'Real GoTrue TOTP enrollment is required');
    await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: factor.id, code: totp(factor.totp.secret) }, expected: 200 });
    const elevated = await owner.client.request('/api/session', { expected: 200 });
    assert.equal(elevated.data.user.aal, 'aal2');
    assert.equal(elevated.data.user.staff, true);
    for (const actor of [buyerA, buyerB, supplier, partner]) {
      await owner.client.request(`/api/admin/applications/${applicationFor(actor)}/decision`, {
        method: 'POST', body: { decision: 'approved', reason: 'Fictional local integration test, verified e-mail and manual test approval' }, expected: 200,
      });
      const current = await actor.client.request('/api/session', { expected: 200 });
      assert.equal(current.data.user.applicationStatus, 'approved');
      actor.companyId = companyFor(actor);
    }
    await ownerAal1.request('/api/admin/companies', { expected: [401, 403] });
  });

  await step('session cookies, no-store and CSRF controls protect real mutations', async () => {
    const reauthenticated = new Client();
    const login = await reauthenticated.signIn(buyerA);
    const cookies = login.headers.getSetCookie();
    const authCookie = cookies.find(value => /httponly/i.test(value));
    assert.ok(authCookie, 'Session must be an HttpOnly cookie');
    assert.match(authCookie, /samesite=(lax|strict)/i);
    if (appOrigin.startsWith('https:')) assert.match(authCookie, /;\s*secure(?:;|$)/i);
    assert.match((await buyerA.client.request('/api/session')).headers.get('cache-control') || '', /no-store/i);
    await buyerA.client.request('/api/rfqs', { method: 'POST', csrf: false, body: { data: rfqData }, expected: 403 });
    await buyerA.client.request('/api/rfqs', { method: 'POST', origin: 'https://untrusted.invalid', body: { data: rfqData }, expected: 403 });
    assert.equal((await buyerA.client.request('/api/rfqs', { expected: 200 })).data.items.length, 0);
  });

  await step('approved supplier and buyer create, edit and submit their own records', async () => {
    const offerResult = await supplier.client.request('/api/offers', { method: 'POST', body: { data: { ...offerData, description: `${offerData.description} ${supplier.companyName}; ${supplier.email}; https://supplier-${runId}.invalid; +47 99999999` } }, expected: 201 });
    offer = offerResult.data.item;
    assert.match(offer.id, /^SB-/);
    assert.equal(offer.status, 'draft');
    await supplier.client.request(`/api/offers/${offer.id}`, { method: 'PATCH', body: { data: { ...offer.data, quantity: '25' } }, expected: 200 });
    await supplier.client.request(`/api/offers/${offer.id}/submit`, { method: 'POST', body: {}, expected: 200 });
    await supplier.client.request(`/api/offers/${offer.id}`, { method: 'PATCH', body: { data: offerData }, expected: [403, 404, 409] });
    const rfqResult = await buyerA.client.request('/api/rfqs', { method: 'POST', body: { data: rfqData }, expected: 201 });
    rfq = rfqResult.data.item;
    await buyerA.client.request(`/api/rfqs/${rfq.id}`, { method: 'PATCH', body: { data: { ...rfqData, quantity: '12' } }, expected: 200 });
    await buyerA.client.request(`/api/rfqs/${rfq.id}/submit`, { method: 'POST', body: {}, expected: 200 });
    await owner.client.request(`/api/admin/rfqs/${rfq.id}/decision`, { method: 'POST', body: { decision: 'in_review', reason: 'Fictional RFQ under internal review' }, expected: 200 });
    expectDenied(await buyerB.client.request(`/api/rfqs/${rfq.id}`), 'Buyer B reading Buyer A RFQ');
    expectDenied(await supplier.client.request(`/api/rfqs/${rfq.id}`), 'Supplier reading buyer RFQ');
    expectDenied(await buyerA.client.request(`/api/offers/${offer.id}`), 'Buyer reading source supplier offer');
    expectDenied(await partner.client.request(`/api/offers/${offer.id}`), 'Partner reading source supplier offer');
    expectDenied(await buyerB.client.request(`/api/rfqs/${rfq.id}`, { method: 'PATCH', body: { data: rfqData } }), 'Cross-company RFQ mutation');
    expectDenied(await supplier.client.request(`/api/admin/offers/${offer.id}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'self approval attempt' } }), 'Supplier self approval');
    assert.deepEqual((await buyerA.client.request('/api/opportunities', { expected: 200 })).data.items, []);
  });

  await step('approval alone is insufficient; only reviewed anonymous cards may be assigned', async () => {
    await owner.client.request(`/api/admin/offers/${offer.id}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional source reviewed internally; not yet disclosed' }, expected: 200 });
    assert.deepEqual((await buyerA.client.request('/api/opportunities', { expected: 200 })).data.items, []);
    const commercial = {
      title: 'Reviewed industrial material opportunity', category: 'Industrial materials',
      specification: 'Approved generic test polymer specification', quantity: '25', unit: 'tonne',
      price: '1250', currency: 'EUR', incoterms: 'FCA', availability: 'By agreement', validUntil: future,
    };
    await owner.client.request('/api/admin/opportunities', { method: 'POST', body: {
      sourceOfferId: offer.id, commercial: { ...commercial, title: `Contact ${supplier.email}` }, reviewedNonIdentifying: true,
    }, expected: 400 });
    await owner.client.request('/api/admin/opportunities', { method: 'POST', body: {
      sourceOfferId: offer.id, commercial: { ...commercial, supplierCompanyId: supplier.companyId }, reviewedNonIdentifying: true,
    }, expected: 400 });
    const created = await owner.client.request('/api/admin/opportunities', { method: 'POST', body: {
      sourceOfferId: offer.id, commercial, reviewedNonIdentifying: true,
    }, expected: 201 });
    opportunity = created.data.item;
    assert.match(opportunity.id, /^SB-/);
    assert.notEqual(opportunity.id, offer.id);
    assert.deepEqual((await buyerA.client.request('/api/opportunities', { expected: 200 })).data.items, []);
    await owner.client.request(`/api/admin/opportunities/${opportunity.id}/assign`, { method: 'POST', body: { recipientCompanyId: buyerA.companyId, role: 'buyer' }, expected: 200 });
  });

  await step('assigned buyer receives anonymous DTO only; unassigned IDs and companies are inaccessible', async () => {
    const cards = await buyerA.client.request('/api/opportunities', { expected: 200 });
    assert.equal(cards.data.items.length, 1);
    assert.equal(cards.data.items[0].id, opportunity.id);
    const sourceInternalId = db(`SELECT id FROM sb.offers WHERE public_id=${sqlLiteral(offer.id)}`);
    const forbidden = [supplier.companyName, supplier.email, `supplier-${runId}.invalid`, '+47 99999999', supplier.companyId, supplier.user.id, sourceInternalId, offer.id, buyerB.companyName, buyerB.email];
    assertNoCounterpartySecrets(cards.data, forbidden);
    assert.match(cards.headers.get('cache-control') || '', /no-store/i);
    for (const actor of [buyerB, supplier, partner]) {
      const list = await actor.client.request('/api/opportunities', { expected: [200, 403] });
      if (list.status === 200) assert.deepEqual(list.data.items, []);
      expectDenied(await actor.client.request(`/api/opportunities/${opportunity.id}`), 'Unassigned opportunity IDOR');
      expectDenied(await actor.client.request(`/api/opportunities/${opportunity.id}/enquiries`, { method: 'POST', body: { message: 'Unassigned enquiry attempt' } }), 'Unassigned enquiry IDOR');
    }
    await buyerA.client.request('/api/profile', { method: 'PATCH', body: { staff: true, role: 'admin', companyId: supplier.companyId, approved: true }, expected: [400, 403, 404, 405] });
    expectDenied(await buyerA.client.request('/api/admin/companies'), 'Buyer self promotion');
    expectDenied(await partner.client.request('/api/admin/companies'), 'Partner management access');
    const enquiry = await buyerA.client.request(`/api/opportunities/${opportunity.id}/enquiries`, {
      method: 'POST', body: { body: 'Please ask ShadowBridge to clarify this fictional specification.' }, expected: 201,
    });
    assert.equal(enquiry.data.item.recipient, 'ShadowBridge');
    await owner.client.request('/api/messages', { method: 'POST', body: {
      resourceType: 'opportunity', resourceId: opportunity.id, companyId: buyerA.companyId, body: 'ShadowBridge is reviewing this fictional enquiry; no direct introduction has been authorized.',
    }, expected: 201 });
    const messages = await buyerA.client.request(`/api/messages?resourceType=opportunity&resourceId=${opportunity.id}`, { expected: 200 });
    assert.ok(messages.data.items.some(message => message.direction === 'ShadowBridge'));
    assertNoCounterpartySecrets(messages.data, forbidden);
    expectDenied(await supplier.client.request(`/api/messages?resourceType=opportunity&resourceId=${opportunity.id}`), 'Supplier accessing buyer enquiry conversation');
  });

  await step('partner manages own proposals; projects and individually agreed commissions require management', async () => {
    const proposalData = { title: 'Fictional partner introduction', description: 'Test trade proposal for ShadowBridge screening.', countries: 'NO', sectors: 'Industrial materials', scope: 'Commercial introduction coordinated by ShadowBridge.' };
    const proposal = (await partner.client.request('/api/proposals', { method: 'POST', body: { data: proposalData }, expected: 201 })).data.item;
    await partner.client.request(`/api/proposals/${proposal.id}`, { method: 'PATCH', body: { data: { ...proposalData, scope: 'Fictional screened introduction with terms to be negotiated individually.' } }, expected: 200 });
    await partner.client.request(`/api/proposals/${proposal.id}/submit`, { method: 'POST', body: {}, expected: 200 });
    expectDenied(await buyerA.client.request(`/api/proposals/${proposal.id}`), 'Buyer accessing partner proposal');
    await partner.client.request('/api/profile', { method: 'PATCH', body: { profile: { countries: ['NO', 'SE'], sectors: ['Industrial materials'], summary: 'Fictional approved partner test profile.' } }, expected: 200 });
    assert.deepEqual((await partner.client.request('/api/commissions', { expected: 200 })).data.items, []);
    const assigned = await owner.client.request('/api/admin/projects', { method: 'POST', body: {
      partnerCompanyId: partner.companyId, title: 'Fictional individually assigned project', summary: 'Approved non-identifying partner cooperation scope.', reviewedNonIdentifying: true,
    }, expected: 201 });
    const project = assigned.data.item;
    assert.equal((await partner.client.request('/api/projects', { expected: 200 })).data.items[0].id, project.id);
    const agreementReference = `FICTIONAL-${runId.toUpperCase()}`;
    await owner.client.request('/api/admin/commissions', { method: 'POST', body: {
      projectId: project.id, amount: 25, currency: 'EUR', agreementReference, agreementConfirmed: false, reviewedNonIdentifying: true,
    }, expected: 400 });
    await owner.client.request('/api/admin/commissions', { method: 'POST', body: {
      projectId: project.id, amount: 25, currency: 'EUR', agreementReference, agreementConfirmed: true, reviewedNonIdentifying: true,
    }, expected: 201 });
    const commission = (await partner.client.request('/api/commissions', { expected: 200 })).data.items;
    assert.equal(commission.length, 1);
    assert.equal(Number(commission[0].amount), 25);
    assert.equal(commission[0].agreementReference, agreementReference);
    assert.ok(!Object.hasOwn(commission[0], 'rate'), 'No automatic default commission percentage may be introduced');
    expectDenied(await buyerA.client.request('/api/commissions'), 'Buyer accessing partner commission');
    expectDenied(await supplier.client.request('/api/projects'), 'Supplier accessing partner project');
    expectDenied(await partner.client.request('/api/admin/commissions', { method: 'POST', body: { projectId: project.id, amount: 9999, currency: 'EUR', agreementReference: 'SELF', agreementConfirmed: true } }), 'Partner self-awarding commission');
  });

  await step('restricted PostgreSQL role enforces company isolation and cannot self-approve', async () => {
    assert.equal(db("SELECT rolbypassrls::text||':'||rolsuper::text FROM pg_roles WHERE rolname='shadowbridge_api'"), 'false:false');
    const isolated = restricted(buyerB, `SELECT count(*) FROM sb.rfqs WHERE public_id=${sqlLiteral(rfq.id)}`);
    assert.equal(isolated.split('\n').at(-1), '0');
    const hiddenSource = restricted(buyerA, `SELECT count(*) FROM sb.offers WHERE public_id=${sqlLiteral(offer.id)}`);
    assert.equal(hiddenSource.split('\n').at(-1), '0');
    const hiddenCard = restricted(buyerB, `SELECT count(*) FROM portal.opportunities WHERE public_id=${sqlLiteral(opportunity.id)}`);
    assert.equal(hiddenCard.split('\n').at(-1), '0');
    assert.throws(() => restricted(supplier, `INSERT INTO sb.offers(id,company_id,created_by,data) VALUES(${sqlLiteral(randomUUID())},${sqlLiteral(buyerA.companyId)},${sqlLiteral(supplier.user.id)},'{}')`), /database operation failed/i);
    assert.throws(() => restricted(buyerB, `UPDATE sb.memberships SET status='approved' WHERE user_id=${sqlLiteral(buyerB.user.id)}`), /database operation failed/i);
    assert.equal(restricted(buyerA, 'SELECT count(*) FROM sb.opportunity_sources').split('\n').at(-1), '0');
    const forcedRls = db("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('sb','portal') AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)");
    assert.equal(forcedRls, '0', 'All private tables must force RLS');
  });

  await step('two recipients of the same anonymous card cannot read each other enquiries', async () => {
    await owner.client.request(`/api/admin/opportunities/${opportunity.id}/assign`, { method: 'POST', body: {
      recipientCompanyId: buyerB.companyId, role: 'buyer',
    }, expected: 200 });
    const privateEnquiry = `FICTIONAL buyer B confidential enquiry ${runId}`;
    await buyerB.client.request(`/api/opportunities/${opportunity.id}/enquiries`, { method: 'POST', body: { body: privateEnquiry }, expected: 201 });
    const path = `/api/messages?resourceType=opportunity&resourceId=${opportunity.id}`;
    const aMessages = (await buyerA.client.request(path, { expected: 200 })).data.items;
    assert.ok(!aMessages.some(message => message.body.includes(privateEnquiry)), 'A shared commercial card must not create a shared buyer conversation');
    const bMessages = (await buyerB.client.request(path, { expected: 200 })).data.items;
    assert.ok(bMessages.some(message => message.body === privateEnquiry));
    assert.ok(!bMessages.some(message => message.body.includes('Please ask ShadowBridge to clarify this fictional specification.')), 'Buyer B must not read Buyer A enquiry');
    const managementA = (await owner.client.request(`${path}&companyId=${buyerA.companyId}`, { expected: 200 })).data.items;
    const managementB = (await owner.client.request(`${path}&companyId=${buyerB.companyId}`, { expected: 200 })).data.items;
    assert.ok(managementB.some(message => message.body === privateEnquiry));
    assert.ok(managementA.some(message => message.body.includes('Please ask ShadowBridge to clarify this fictional specification.')));
    assert.ok(!managementA.some(message => message.body === privateEnquiry));
    const forged = await buyerA.client.request(`${path}&companyId=${buyerB.companyId}`);
    assert.ok([200, 400, 403, 404].includes(forged.status));
    if (forged.status === 200) assert.ok(!forged.data.items.some(message => message.body === privateEnquiry), 'Forging a conversation company parameter must never expose another buyer enquiry');
  });

  await step('real password recovery uses only local mail and invalidates the old password', async () => {
    const recoveryClient = new Client();
    const since = Date.now() - 1000;
    await recoveryClient.request('/api/auth/recover', { method: 'POST', body: { email: buyerB.email }, expected: [200, 202] });
    await confirmMessage(recoveryClient, await waitForMessage(buyerB.email, { after: since }));
    const nextPassword = password();
    await recoveryClient.request('/api/auth/password', { method: 'POST', body: { password: nextPassword }, expected: 200 });
    const oldPassword = new Client();
    await oldPassword.request('/api/auth/login', { method: 'POST', body: { email: buyerB.email, password: buyerB.password }, expected: [400, 401] });
    buyerB.password = nextPassword;
    buyerB.client = new Client();
    await buyerB.client.signIn(buyerB);
    const unknown = new Client();
    const unknownResult = await unknown.request('/api/auth/recover', { method: 'POST', body: { email: `${runId}.unknown@test.shadowbridge.invalid` }, expected: [200, 202] });
    assert.ok(unknownResult.data, 'Recovery endpoint must return a neutral response for unknown addresses');
  });

  await step('suspension blocks an existing session immediately and audit history survives', async () => {
    assert.equal((await buyerA.client.request('/api/opportunities', { expected: 200 })).data.items.length, 1);
    await owner.client.request(`/api/admin/accounts/${buyerA.user.id}/status`, { method: 'POST', body: { status: 'suspended' }, expected: 200 });
    expectDenied(await buyerA.client.request('/api/opportunities'), 'Suspended existing session');
    expectDenied(await buyerA.client.request(`/api/rfqs/${rfq.id}`), 'Suspended own record');
    assert.equal(restricted(buyerA, `SELECT count(*) FROM portal.opportunities WHERE public_id=${sqlLiteral(opportunity.id)}`).split('\n').at(-1), '0');
    const audit = await owner.client.request('/api/admin/audit', { expected: 200 });
    assert.ok(audit.data.items.length > 0);
    const durable = db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${sqlLiteral(owner.user.id)}`);
    assert.ok(Number(durable) > 0, 'Management actions must have durable activity logs');
  });
});
