import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appOrigin, Client, db, sqlLiteral, runId, registerActor, verifyActor,
  bootstrapOwner, enableMfa, catalogCategory, qualifySupplier, assertNoCounterpartySecrets,
  waitForMessage, confirmMessage, password,
} from './helpers.mjs';

const applicationFor = actor => db(`SELECT id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)} ORDER BY created_at LIMIT 1`);
const companyFor = actor => db(`SELECT company_id FROM sb.applications WHERE user_id=${sqlLiteral(actor.user.id)} ORDER BY created_at LIMIT 1`);
function asRole(actor, sql, { aal = 'aal2', age = 0 } = {}) {
  return db(`BEGIN; SET LOCAL ROLE shadowbridge_api;
    SELECT set_config('request.jwt.claim.sub',${sqlLiteral(actor.user.id)},true),
    set_config('request.jwt.claim.aal',${sqlLiteral(aal)},true),
    set_config('request.jwt.claim.mfa_verified_at',(extract(epoch FROM statement_timestamp())-${Number(age)})::text,true);
    ${sql}; ROLLBACK;`);
}
const deniedSql = (actor, sql, options) => assert.throws(() => asRole(actor, sql, options), /database operation failed/i);
const finalValue = value => value.split('\n').at(-1);

test('RBAC: real individual staff identities, owner protection, delegation and company isolation', { timeout: 300_000 }, async t => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(appOrigin).hostname), 'Security fixtures must never target a public deployment');
  const category = await catalogCategory(new Client());
  const actors = {};
  let owner, supplier, buyerA, buyerB, employee, sourceOffer, privateRfq;
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const offerData = { ...category, productName: `FICTIONAL RBAC product ${runId}`, specification: 'Fictional generic non-hazardous material.', countryOfOrigin: 'NO', quantity: 10, unit: 'tonne', price: 123, currency: 'PLN', incoterms: 'FCA' };
  const rfqData = { ...category, product: `FICTIONAL private RFQ ${runId}`, specifications: 'Fictional industrial material; no real buyer requirements.', quantity: 2, unit: 'tonne', budget: 456, currency: 'PLN', deliveryCountry: 'NO', deadline: future };
  async function approve(actor, client = owner.client) {
    await client.request(`/api/admin/applications/${applicationFor(actor)}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'FICTIONAL local RBAC test; genuine email proof and individual manual approval.' }, expected: 200 });
    actor.companyId = companyFor(actor);
  }

  await t.test('seven roles use separate verified accounts and require real MFA', async () => {
    owner = await verifyActor(await registerActor('partner', 'rbac-owner'));
    bootstrapOwner(owner);
    const aal1 = new Client(); await aal1.signIn(owner);
    await aal1.request('/api/staff/overview', { expected: 403 });
    await aal1.request('/api/staff/roles', { method: 'POST', body: { userId: owner.user.id, role: 'owner', active: true }, expected: 403 });
    await enableMfa(owner);
    for (const role of ['general_director', 'procurement_manager', 'sales_manager', 'operations_manager', 'compliance_finance', 'staff_analyst']) {
      const actor = await verifyActor(await registerActor('partner', `rbac-${role.replaceAll('_', '-')}`));
      actors[role] = actor;
      await owner.client.request('/api/staff/roles', { method: 'POST', body: { userId: actor.user.id, role, active: true }, expected: 200 });
      await actor.client.request('/api/staff/overview', { expected: 403 });
      await enableMfa(actor);
      const access = (await actor.client.request('/api/staff/access', { expected: 200 })).data;
      assert.ok(access.roles.includes(role));
      assert.equal(access.owner, false);
      assert.ok(!access.permissions.includes('security.manage'));
      assert.ok(!access.permissions.includes('strategic.manage'));
    }
    const access = (await owner.client.request('/api/staff/access', { expected: 200 })).data;
    assert.equal(access.owner, true);
    assert.ok(access.permissions.includes('security.manage'));
    assert.equal(new Set([owner, ...Object.values(actors)].map(actor => actor.user.id)).size, 7);
  });

  await t.test('director cannot promote, demote, suspend or change the owner through direct API calls', async () => {
    const director = actors.general_director;
    for (const payload of [
      { userId: director.user.id, role: 'owner', active: true },
      { userId: actors.staff_analyst.user.id, role: 'owner', active: true },
      { userId: actors.staff_analyst.user.id, role: 'general_director', active: true },
      { userId: owner.user.id, role: 'owner', active: false },
      { userId: owner.user.id, role: 'staff_analyst', active: true },
    ]) await director.client.request('/api/staff/roles', { method: 'POST', body: payload, expected: 403 });
    for (const payload of [
      { userId: director.user.id, permission: 'staff.manage', effect: 'allow' },
      { userId: actors.staff_analyst.user.id, permission: 'security.manage', effect: 'allow' },
      { userId: owner.user.id, permission: 'overview.read', effect: 'deny' },
    ]) await director.client.request('/api/staff/permissions', { method: 'POST', body: payload, expected: 403 });
    await director.client.request(`/api/admin/accounts/${owner.user.id}/status`, { method: 'POST', body: { status: 'suspended' }, expected: 403 });
    await director.client.request('/api/staff/limits', { method: 'POST', body: { userId: director.user.id, amount: 999999999, currency: 'EUR' }, expected: 403 });
    await director.client.request(`/api/admin/accounts/${owner.user.id}`, { method: 'DELETE', body: {}, expected: [403, 404, 405] });
    const status = JSON.parse(db(`SELECT json_build_object('status',a.status,'owner',EXISTS(SELECT FROM sb.staff_role_assignments r WHERE r.user_id=a.user_id AND r.role_key='owner' AND r.active)) FROM sb.accounts a WHERE a.user_id=${sqlLiteral(owner.user.id)}`));
    assert.deepEqual(status, { status: 'active', owner: true });
    assert.equal((await owner.client.request('/api/staff/access', { expected: 200 })).data.owner, true);
  });

  await t.test('PostgreSQL enforces protected identity, fresh owner MFA and immutable authentication authority', async () => {
    const director = actors.general_director;
    deniedSql(director, `UPDATE sb.accounts SET status='suspended' WHERE user_id=${sqlLiteral(owner.user.id)}`);
    deniedSql(director, `DELETE FROM sb.accounts WHERE user_id=${sqlLiteral(owner.user.id)}`);
    deniedSql(director, `UPDATE sb.staff_role_assignments SET role_key='owner' WHERE user_id=${sqlLiteral(director.user.id)}`);
    deniedSql(director, `UPDATE auth.users SET email='forged@test.shadowbridge.invalid' WHERE id=${sqlLiteral(owner.user.id)}`);
    deniedSql(director, `DELETE FROM auth.mfa_factors WHERE user_id=${sqlLiteral(owner.user.id)}`);
    deniedSql(director, `SELECT sb.bootstrap_owner(${sqlLiteral(director.user.id)}::uuid)`);
    const appoint = `SELECT sb.set_staff_role(${sqlLiteral(actors.staff_analyst.user.id)}::uuid,'general_director',true)`;
    deniedSql(owner, appoint, { age: 301 });
    deniedSql(owner, appoint, { age: -120 });
    deniedSql(owner, appoint, { aal: 'aal1' });
    assert.doesNotThrow(() => asRole(owner, appoint));
    assert.equal(db(`SELECT count(*) FROM sb.staff_role_assignments WHERE user_id=${sqlLiteral(actors.staff_analyst.user.id)} AND role_key='general_director'`), '0', 'Rolled-back privilege tests must not leave escalated fixtures');
  });

  await t.test('managers approve ordinary work independently within their own granular scope', async () => {
    supplier = await verifyActor(await registerActor('supplier', 'rbac-supplier'));
    buyerA = await verifyActor(await registerActor('buyer', 'rbac-buyer-a'));
    buyerB = await verifyActor(await registerActor('buyer', 'rbac-buyer-b'));
    employee = await verifyActor(await registerActor('partner', 'rbac-company-employee'));
    await approve(supplier, actors.procurement_manager.client);
    await approve(buyerA, actors.sales_manager.client);
    await approve(buyerB, actors.sales_manager.client);
    await approve(employee);
    sourceOffer = (await supplier.client.request('/api/offers', { method: 'POST', body: { data: offerData }, expected: 201 })).data.item;
    await supplier.client.request(`/api/offers/${sourceOffer.id}/submit`, { method: 'POST', body: {}, expected: 200 });
    const decide = { decision: 'approved', reason: 'FICTIONAL independently delegated procurement approval.' };
    await actors.sales_manager.client.request(`/api/staff/offers/${sourceOffer.id}/decision`, { method: 'POST', body: decide, expected: 403 });
    await actors.procurement_manager.client.request(`/api/staff/offers/${sourceOffer.id}/decision`, { method: 'POST', body: decide, expected: [400, 409] });
    await qualifySupplier(actors.procurement_manager, sourceOffer.id);
    await actors.procurement_manager.client.request(`/api/staff/offers/${sourceOffer.id}/decision`, { method: 'POST', body: decide, expected: 200 });
    privateRfq = (await buyerA.client.request('/api/rfqs', { method: 'POST', body: { data: rfqData }, expected: 201 })).data.item;
    await buyerA.client.request(`/api/rfqs/${privateRfq.id}/submit`, { method: 'POST', body: {}, expected: 200 });
    await actors.procurement_manager.client.request(`/api/admin/rfqs/${privateRfq.id}/decision`, { method: 'POST', body: { decision: 'in_review', reason: 'Unauthorized cross-scope decision.' }, expected: 403 });
    await actors.sales_manager.client.request(`/api/admin/rfqs/${privateRfq.id}/decision`, { method: 'POST', body: { decision: 'in_review', reason: 'FICTIONAL sales manager reviews buyer requirement without owner action.' }, expected: 200 });
    assert.equal((await supplier.client.request(`/api/offers/${sourceOffer.id}`, { expected: 200 })).data.item.data.currency, 'PLN');
    assert.equal((await buyerA.client.request(`/api/rfqs/${privateRfq.id}`, { expected: 200 })).data.item.data.currency, 'PLN');
    assert.equal(finalValue(asRole(actors.operations_manager, "SELECT sb.has_permission('projects.edit') AND NOT sb.has_permission('offers.approve')")), 't');
    assert.equal(finalValue(asRole(actors.compliance_finance, "SELECT sb.has_permission('commissions.create') AND NOT sb.has_permission('staff.manage')")), 't');
  });

  await t.test('additional company employee has only the explicitly granted company records; revocation is immediate', async () => {
    const endpoint = '/api/staff/company-members';
    await employee.client.request(`/api/rfqs/${privateRfq.id}`, { expected: 403 });
    await owner.client.request(endpoint, { method: 'POST', body: { companyId: buyerA.companyId, userId: employee.user.id, role: 'buyer', status: 'approved' }, expected: 200 });
    const visible = (await employee.client.request(`/api/rfqs/${privateRfq.id}`, { expected: 200 })).data.item;
    assert.equal(visible.id, privateRfq.id);
    const otherRfq = (await buyerB.client.request('/api/rfqs', { method: 'POST', body: { data: { ...rfqData, product: `FICTIONAL isolated company B ${runId}` } }, expected: 201 })).data.item;
    await employee.client.request(`/api/rfqs/${otherRfq.id}`, { expected: 404 });
    await employee.client.request(`/api/offers/${sourceOffer.id}`, { expected: 403 });
    assert.equal(finalValue(asRole(employee, `SELECT count(*) FROM sb.rfqs WHERE public_id=${sqlLiteral(otherRfq.id)}`, { aal: 'aal1' })), '0');
    await employee.client.request('/api/staff/company-members', { method: 'POST', body: { companyId: buyerB.companyId, userId: employee.user.id, role: 'buyer', status: 'approved' }, expected: 403 });
    await owner.client.request(endpoint, { method: 'POST', body: { companyId: buyerA.companyId, userId: employee.user.id, role: 'buyer', status: 'revoked' }, expected: 200 });
    await employee.client.request(`/api/rfqs/${privateRfq.id}`, { expected: 403 });
  });

  await t.test('director, operations and finance complete ordinary work without an owner decision', async () => {
    const director = actors.general_director;
    const operations = actors.operations_manager;
    const finance = actors.compliance_finance;
    await director.client.request(`/api/admin/rfqs/${privateRfq.id}/decision`, { method: 'POST', body: {
      decision: 'accepted', reason: 'FICTIONAL independent director review of the submitted requirement.',
    }, expected: 200 });
    assert.equal((await buyerA.client.request(`/api/rfqs/${privateRfq.id}`, { expected: 200 })).data.item.status, 'accepted');
    await operations.client.request(`/api/admin/rfqs/${privateRfq.id}/decision`, { method: 'POST', body: {
      decision: 'accepted', reason: 'FICTIONAL denied cross-scope operations decision.',
    }, expected: 403 });

    const project = (await operations.client.request('/api/admin/projects', { method: 'POST', body: {
      partnerCompanyId: employee.companyId, title: `FICTIONAL delegated operations project ${runId}`,
      summary: 'Fictional individually assigned cooperation; no real transaction or transport.', reviewedNonIdentifying: true,
    }, expected: 201 })).data.item;
    assert.ok((await employee.client.request('/api/projects', { expected: 200 })).data.items.some(item => item.id === project.id));
    assert.ok((await director.client.request('/api/admin/projects', { expected: 200 })).data.items.some(item => item.id === project.id));
    await actors.procurement_manager.client.request('/api/admin/projects', { expected: 403 });
    const agreed = {
      projectId: project.id, amount: 50, currency: 'EUR', agreementReference: `FICTIONAL-${runId.toUpperCase()}`,
      agreementConfirmed: true, reviewedNonIdentifying: true,
    };
    await operations.client.request('/api/admin/commissions', { method: 'POST', body: agreed, expected: 403 });
    await finance.client.request('/api/admin/commissions', { method: 'POST', body: agreed, expected: 201 });
    const commission = (await employee.client.request('/api/commissions', { expected: 200 })).data.items.find(item => item.projectId === project.id);
    assert.equal(Number(commission.amount), 50);
    assert.equal(commission.currency, 'EUR');
    const overview = (await actors.staff_analyst.client.request('/api/staff/overview', { expected: 200 })).data;
    assert.deepEqual(Object.keys(overview.counts), ['pendingRiskApprovals']);
    assert.deepEqual(overview.recentActivity, []);
    await actors.staff_analyst.client.request('/api/admin/companies', { expected: 403 });
    await actors.staff_analyst.client.request('/api/admin/rfqs', { expected: 403 });
    await actors.staff_analyst.client.request('/api/admin/commissions', { expected: 403 });
    const actorsOfDecisions = JSON.parse(db(`SELECT coalesce(json_agg(DISTINCT actor_id),'[]') FROM sb.audit_events WHERE actor_id IN (${[director, operations, finance].map(actor => sqlLiteral(actor.user.id)).join(',')})`));
    for (const actor of [director, operations, finance]) assert.ok(actorsOfDecisions.includes(actor.user.id), 'Delegated operational actions must identify the actual staff actor in audit');
  });

  await t.test('high-risk financial decisions require independent exact authorization and cannot be replayed', async () => {
    const finance = actors.compliance_finance;
    await owner.client.request('/api/staff/limits', { method: 'POST', body: { userId: finance.user.id, amount: 100, currency: 'EUR' }, expected: 200 });
    const project = (await owner.client.request('/api/admin/projects', { method: 'POST', body: {
      partnerCompanyId: employee.companyId, title: `FICTIONAL controlled finance project ${runId}`,
      summary: 'Fictional individually assigned local cooperation; no transaction or payment.', reviewedNonIdentifying: true,
    }, expected: 201 })).data.item;
    const agreed = { projectId: project.id, amount: 200, currency: 'PLN', agreementReference: `FICTIONAL-${runId.toUpperCase()}`, agreementConfirmed: true, reviewedNonIdentifying: true };
    await finance.client.request('/api/admin/commissions', { method: 'POST', body: agreed, expected: 403 });
    const request = await finance.client.request('/api/staff/risk-approvals', { method: 'POST', body: {
      action: 'commissions.create', projectId: project.id, amount: agreed.amount, currency: agreed.currency, agreementReference: agreed.agreementReference, status: 'agreed',
    }, expected: 201 });
    const approvalId = request.data.id;
    await finance.client.request(`/api/staff/risk-approvals/${approvalId}/decision`, { method: 'POST', body: { decision: 'approved' }, expected: 403 });
    await actors.general_director.client.request(`/api/staff/risk-approvals/${approvalId}/decision`, { method: 'POST', body: { decision: 'approved' }, expected: 403 });
    await owner.client.request(`/api/staff/risk-approvals/${approvalId}/decision`, { method: 'POST', body: { decision: 'approved' }, expected: 200 });
    await finance.client.request('/api/admin/commissions', { method: 'POST', body: { ...agreed, amount: 201, approvalId }, expected: 403 });
    await finance.client.request('/api/admin/commissions', { method: 'POST', body: { ...agreed, approvalId }, expected: 201 });
    await finance.client.request('/api/admin/commissions', { method: 'POST', body: { ...agreed, approvalId }, expected: 403 });
    assert.equal(db(`SELECT status FROM sb.risk_approvals WHERE id=${sqlLiteral(approvalId)}`), 'consumed');
  });

  await t.test('individual overrides deny raw identities and take effect without re-login', async () => {
    const analyst = actors.staff_analyst;
    await analyst.client.request('/api/staff/offers', { expected: 403 });
    await owner.client.request('/api/staff/permissions', { method: 'POST', body: { userId: analyst.user.id, permission: 'offers.read', effect: 'allow' }, expected: 200 });
    const projected = (await analyst.client.request(`/api/staff/offers/${sourceOffer.id}`, { expected: 200 })).data.item;
    assert.equal(projected.identityRestricted, true);
    assertNoCounterpartySecrets(projected, [supplier.email, supplier.companyName, supplier.user.id, supplier.companyId]);
    assert.equal(finalValue(asRole(analyst, `SELECT count(*) FROM sb.offers WHERE public_id=${sqlLiteral(sourceOffer.id)}`)), '0', 'Offers read alone must never imply raw counterparty access');
    await owner.client.request('/api/staff/permissions', { method: 'POST', body: { userId: actors.procurement_manager.user.id, permission: 'offers.edit', effect: 'deny' }, expected: 200 });
    await actors.procurement_manager.client.request(`/api/staff/offers/${sourceOffer.id}/assignment`, { method: 'POST', body: { responsible: 'me' }, expected: 403 });
    await owner.client.request('/api/staff/permissions', { method: 'POST', body: { userId: analyst.user.id, permission: 'offers.read', effect: 'deny' }, expected: 200 });
    await analyst.client.request('/api/staff/offers', { expected: 403 });
    await owner.client.request('/api/staff/roles', { method: 'POST', body: { userId: actors.procurement_manager.user.id, role: 'procurement_manager', active: false }, expected: 200 });
    await actors.procurement_manager.client.request('/api/staff/offers', { expected: 403 });
    await owner.client.request(`/api/admin/accounts/${analyst.user.id}/status`, { method: 'POST', body: { status: 'suspended' }, expected: 200 });
    await analyst.client.request('/api/staff/access', { expected: [401, 403] });
    const audit = JSON.parse(db(`SELECT coalesce(json_agg(json_build_object('resource',resource,'metadata',metadata)),'[]') FROM sb.audit_events WHERE actor_id=${sqlLiteral(owner.user.id)} AND resource IN ('sb.staff_role_assignments','sb.staff_permission_overrides','sb.accounts')`));
    assert.ok(audit.some(item => item.resource === 'sb.staff_role_assignments' && item.metadata.active === false));
    assert.ok(audit.some(item => item.resource === 'sb.staff_permission_overrides' && item.metadata.effect === 'deny'));
    assert.equal((await owner.client.request('/api/staff/access', { expected: 200 })).data.owner, true);
  });

  await t.test('email recovery alone cannot replace the owner password or authentication factors', async () => {
    const recovery = new Client();
    const factorCount = db(`SELECT count(*) FROM auth.mfa_factors WHERE user_id=${sqlLiteral(owner.user.id)} AND status='verified'`);
    const before = Date.now() - 1000;
    await recovery.request('/api/auth/recover', { method: 'POST', body: { email: owner.email }, expected: 202 });
    await confirmMessage(recovery, await waitForMessage(owner.email, { after: before }));
    const current = await recovery.request('/api/session', { expected: 200 });
    assert.equal(current.data.user.id, owner.user.id);
    assert.equal(current.data.user.recoveryOnly, true);
    await recovery.request('/api/auth/password', { method: 'POST', body: { password: password() }, expected: 403 });
    await recovery.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: 403 });
    await recovery.request('/api/staff/roles', { method: 'POST', body: { userId: owner.user.id, role: 'owner', active: false }, expected: 403 });
    assert.equal(db(`SELECT count(*) FROM auth.mfa_factors WHERE user_id=${sqlLiteral(owner.user.id)} AND status='verified'`), factorCount);
    const original = new Client();
    assert.equal((await original.signIn(owner)).session.user.id, owner.user.id, 'Denied recovery must preserve the original owner credentials');
    assert.equal((await owner.client.request('/api/staff/access', { expected: 200 })).data.owner, true, 'Denied recovery must preserve the authorized owner session');
  });
});
