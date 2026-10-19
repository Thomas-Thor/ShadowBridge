-- Real PostgreSQL/RLS checks. All fixtures are fictional and rolled back.
-- Run only against an isolated test database with migrations001..010 applied,
-- before persistent OWNER fixtures are bootstrapped. Never use the owner's demo database.
-- Last-OWNER assertions intentionally require this isolated test baseline.
-- docker exec -i shadowbridge-private-local-postgres-1 psql -U postgres -d shadowbridge -v ON_ERROR_STOP=1 < supabase/tests/staff-rbac.sql
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label;END IF;END $$;
CREATE FUNCTION pg_temp.denied(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;EXCEPTION WHEN insufficient_privilege THEN RETURN;END;
 RAISE EXCEPTION 'FAIL: unauthorized action accepted: %',label;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT ('00000000-0000-4000-8000-00000000e0'||lpad(to_hex(n),2,'0'))::uuid,'rbac-'||n||'@test.shadowbridge.invalid',now() FROM generate_series(1,16) n;
SELECT sb.bootstrap_owner('00000000-0000-4000-8000-00000000e001');
INSERT INTO sb.staff_grants(user_id,active) VALUES('00000000-0000-4000-8000-00000000e00c',true);
SET LOCAL ROLE shadowbridge_api;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true),set_config('request.jwt.claim.aal','aal1',true);
SELECT pg_temp.assert_true(sb.has_staff_grant() AND NOT sb.has_permission('staff.manage'),'MFA required despite OWNER assignment');
SELECT pg_temp.assert_true(sb.staff_context()->'permissions'='[]'::jsonb,'aal1 effective permissions empty');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e002','general_director',true)$q$,'aal1 role grant');
SELECT set_config('request.jwt.claim.aal','aal2',true);
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e002','general_director',true)$q$,'aal2 without a fresh TOTP proof cannot appoint director');
SELECT set_config('request.jwt.claim.mfa_verified_at',(extract(epoch FROM statement_timestamp())-301)::text,true);
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e002','general_director',true)$q$,'stale owner MFA cannot appoint director');
SELECT set_config('request.jwt.claim.mfa_verified_at',(extract(epoch FROM statement_timestamp())+120)::text,true);
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e002','general_director',true)$q$,'future owner MFA proof rejected');
SELECT set_config('request.jwt.claim.mfa_verified_at',extract(epoch FROM statement_timestamp())::text,true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e002','general_director',true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e003','procurement_manager',true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e004','sales_manager',true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e005','operations_manager',true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e006','compliance_finance',true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e007','staff_analyst',true);
SELECT pg_temp.assert_true(jsonb_array_length(sb.staff_directory()->'items')>=8,'staff directory includes roles and legacy account');
SELECT pg_temp.denied($q$SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e007','security.manage','allow')$q$,'critical security permission non-delegable even by OWNER');
SELECT pg_temp.denied($q$SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e007','strategic.manage','allow')$q$,'strategic authority non-delegable even by OWNER');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e001','owner',false)$q$,'last OWNER removal');
SELECT pg_temp.denied($q$SELECT sb.suspend_account('00000000-0000-4000-8000-00000000e001','suspended')$q$,'last OWNER suspension');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e002',true);
SELECT pg_temp.assert_true(sb.has_permission('staff.manage') AND sb.has_permission('offers.approve') AND NOT sb.has_permission('security.manage'),'director operational privileges exclude owner settings');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e007','owner',true)$q$,'director appoint OWNER');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e007','general_director',true)$q$,'director appoint director');
SELECT pg_temp.denied($q$SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e007','security.manage','allow')$q$,'director grant critical security');
SELECT pg_temp.denied($q$SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e007','counterparties.reveal','allow')$q$,'director grant external identity disclosure');
SELECT pg_temp.denied($q$SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e002','audit.read','allow')$q$,'director mutate self permissions');
SELECT pg_temp.denied($q$SELECT sb.suspend_account('00000000-0000-4000-8000-00000000e001','suspended')$q$,'director suspend OWNER');
SELECT pg_temp.denied($q$UPDATE sb.accounts SET status='suspended' WHERE user_id='00000000-0000-4000-8000-00000000e001'$q$,'direct account status update cannot bypass OWNER protection');
SELECT pg_temp.denied($q$DELETE FROM sb.accounts WHERE user_id='00000000-0000-4000-8000-00000000e001'$q$,'director cannot delete OWNER');
SELECT pg_temp.denied($q$UPDATE sb.staff_role_assignments SET active=false WHERE user_id='00000000-0000-4000-8000-00000000e001'$q$,'direct role table update forbidden');
SELECT pg_temp.denied($q$UPDATE auth.users SET email='forged@test.shadowbridge.invalid' WHERE id='00000000-0000-4000-8000-00000000e001'$q$,'director cannot change OWNER authentication');
SELECT pg_temp.denied($q$DELETE FROM auth.mfa_factors WHERE user_id='00000000-0000-4000-8000-00000000e001'$q$,'director cannot delete OWNER MFA factors');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e001','owner',false)$q$,'director cannot demote OWNER');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e002','general_director',false)$q$,'director cannot alter protected director role');

SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e00d','staff_analyst',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e003',true);
SELECT pg_temp.assert_true(sb.has_permission('offers.edit') AND sb.has_permission('offers.approve') AND NOT sb.has_permission('commissions.create'),'procurement has no finance write');
SELECT pg_temp.denied($q$SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e007','sales_manager',true)$q$,'manager cannot appoint staff');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e004',true);
SELECT pg_temp.assert_true(sb.has_permission('rfqs.approve') AND sb.has_permission('opportunities.share') AND NOT sb.has_permission('offers.edit'),'sales operational scope');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e005',true);
SELECT pg_temp.assert_true(sb.has_permission('projects.edit') AND NOT sb.has_permission('offers.approve'),'operations operational scope');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e006',true);
SELECT pg_temp.assert_true(sb.has_permission('commissions.create') AND sb.has_permission('audit.read') AND NOT sb.has_permission('staff.manage'),'finance operational scope');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00c',true);
SELECT pg_temp.assert_true(sb.has_staff_grant() AND NOT sb.is_staff() AND NOT sb.has_permission('offers.read'),'legacy grant never auto-promoted');
SELECT pg_temp.denied($q$SELECT sb.bootstrap_owner('00000000-0000-4000-8000-00000000e00c')$q$,'runtime cannot bootstrap OWNER');

-- Three companies, with two separately authenticated users in one supplier.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e008',true),set_config('request.jwt.claim.aal','aal1',true);
SELECT sb.submit_application('supplier','{"legal_name":"FICTIONAL RBAC Supplier","registration_number":"TEST-RBAC-SUPPLIER","country":"NO"}') AS supplier_application \gset
SELECT company_id AS supplier_company FROM sb.applications WHERE id=:'supplier_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00a',true);
SELECT sb.submit_application('buyer','{"legal_name":"FICTIONAL RBAC Buyer A","registration_number":"TEST-RBAC-BUYER-A","country":"NO"}') AS buyer_application \gset
SELECT company_id AS buyer_company FROM sb.applications WHERE id=:'buyer_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00b',true);
SELECT sb.submit_application('buyer','{"legal_name":"FICTIONAL RBAC Buyer B","registration_number":"TEST-RBAC-BUYER-B","country":"NO"}') AS other_application \gset
SELECT company_id AS other_company FROM sb.applications WHERE id=:'other_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true),set_config('request.jwt.claim.aal','aal2',true);
SELECT sb.decide_application(:'supplier_application','approved','FICTIONAL RBAC test');
SELECT sb.decide_application(:'buyer_application','approved','FICTIONAL RBAC test');
SELECT sb.decide_application(:'other_application','approved','FICTIONAL RBAC test');
SELECT sb.add_company_member(:'supplier_company','00000000-0000-4000-8000-00000000e009','supplier') AS additional_member \gset
SELECT sb.add_company_member(:'buyer_company','00000000-0000-4000-8000-00000000e00e','buyer');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00f',true),set_config('request.jwt.claim.aal','aal1',true);
SELECT sb.submit_application('partner','{"legal_name":"FICTIONAL RBAC Partner","registration_number":"TEST-RBAC-PARTNER","country":"NO"}') AS partner_application \gset
SELECT company_id AS partner_company FROM sb.applications WHERE id=:'partner_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true),set_config('request.jwt.claim.aal','aal2',true);
SELECT sb.decide_application(:'partner_application','approved','FICTIONAL RBAC test');
SELECT sb.add_company_member(:'partner_company','00000000-0000-4000-8000-00000000e010','partner');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00a',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.rfqs(company_id,created_by,status,data) VALUES(:'buyer_company',sb.user_id(),'draft','{"product":"FICTIONAL multiuser RFQ","categoryId":"10000000-0000-4000-8000-000000000001"}') RETURNING id AS rfq_id \gset
SELECT set_config('test.rfq_id',:'rfq_id',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00e',true);
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.rfqs WHERE id=current_setting('test.rfq_id')::uuid),'same-company second buyer can read requests');
UPDATE sb.rfqs SET data=data||'{"product":"FICTIONAL unauthorized edit"}' WHERE id=:'rfq_id';
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.rfqs WHERE id=current_setting('test.rfq_id')::uuid AND data->>'product'='FICTIONAL multiuser RFQ'),'second buyer cannot edit another employee draft');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00f',true);
INSERT INTO sb.partner_proposals(company_id,created_by,status,data) VALUES(:'partner_company',sb.user_id(),'draft','{"title":"FICTIONAL multiuser partner proposal"}') RETURNING id AS proposal_id \gset
SELECT set_config('test.proposal_id',:'proposal_id',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e010',true);
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.partner_proposals WHERE id=current_setting('test.proposal_id')::uuid),'same-company second partner can read proposals');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM sb.rfqs WHERE id=current_setting('test.rfq_id')::uuid),'second partner cannot read unrelated buyer requests');

SELECT set_config('test.supplier_company',:'supplier_company',true),set_config('test.buyer_company',:'buyer_company',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e008',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.offers(company_id,created_by,status,data) VALUES(:'supplier_company',sb.user_id(),'draft','{"title":"FICTIONAL RBAC commercial offer","categoryId":"10000000-0000-4000-8000-000000000001"}') RETURNING id AS offer_id \gset
SELECT set_config('test.offer_id',:'offer_id',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e009',true);
SELECT pg_temp.assert_true(sb.owns_company(current_setting('test.supplier_company')::uuid),'additional verified company member recognized');
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.offers WHERE id=current_setting('test.offer_id')::uuid),'same-company second user can read supplier offers');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM sb.companies WHERE id=current_setting('test.buyer_company')::uuid),'second supplier user cannot read unrelated buyer');
SELECT pg_temp.denied($q$INSERT INTO sb.offers(company_id,created_by,data) VALUES(current_setting('test.buyer_company')::uuid,sb.user_id(),'{"categoryId":"10000000-0000-4000-8000-000000000001"}')$q$,'second user cannot forge foreign company');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e00a',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM sb.offers WHERE id=current_setting('test.offer_id')::uuid),'buyer cannot read supplier offer');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true),set_config('request.jwt.claim.aal','aal2',true);
SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e007','offers.read','allow');
SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e007','offers.approve','allow');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e007',true);
SELECT pg_temp.assert_true(sb.has_permission('offers.read') AND NOT sb.has_permission('counterparties.read'),'individual offer-only permission does not reveal sources');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM sb.offers WHERE id=current_setting('test.offer_id')::uuid),'offer-only analyst cannot SELECT raw identifying data');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM sb.companies WHERE id=current_setting('test.supplier_company')::uuid),'offer-only analyst cannot SELECT source company');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true);
SELECT sb.set_staff_permission('00000000-0000-4000-8000-00000000e003','offers.approve','deny');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e003',true);
SELECT pg_temp.assert_true(NOT sb.has_permission('offers.approve') AND sb.has_permission('offers.edit'),'deny override takes immediate precedence');
SELECT pg_temp.denied($q$UPDATE sb.offers SET status='approved' WHERE id=current_setting('test.offer_id')::uuid$q$,'edit permission does not imply approval');
UPDATE sb.offers SET data='{"title":"FICTIONAL revised commercial offer","categoryId":"10000000-0000-4000-8000-000000000001"}' WHERE id=:'offer_id';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true);
SELECT sb.set_staff_role('00000000-0000-4000-8000-00000000e003','procurement_manager',false);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e003',true);
SELECT pg_temp.assert_true(NOT sb.is_staff() AND NOT sb.has_permission('offers.edit'),'role revocation immediate in existing session');

-- A real DB trigger enforces monetary limits and consumes exact, independent approval.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true);
SELECT set_config('request.jwt.claim.mfa_verified_at',(extract(epoch FROM statement_timestamp())-301)::text,true);
SELECT pg_temp.denied($q$SELECT sb.set_staff_limit('00000000-0000-4000-8000-00000000e006',100,'EUR')$q$,'owner limits require fresh MFA');
SELECT set_config('request.jwt.claim.mfa_verified_at',extract(epoch FROM statement_timestamp())::text,true);
SELECT sb.set_staff_limit('00000000-0000-4000-8000-00000000e006',100,'EUR');
INSERT INTO sb.projects(partner_company_id,title) VALUES(:'supplier_company','FICTIONAL RBAC project') RETURNING id AS project_id \gset
SELECT set_config('test.project_id',:'project_id',true);
SELECT set_config('request.jwt.claim.mfa_verified_at',(extract(epoch FROM statement_timestamp())-301)::text,true);
SELECT pg_temp.denied($q$INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(current_setting('test.project_id')::uuid,current_setting('test.supplier_company')::uuid,10001,'EUR')$q$,'OWNER high-value commission requires fresh MFA');
SELECT pg_temp.denied($q$INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(current_setting('test.project_id')::uuid,current_setting('test.supplier_company')::uuid,1,'USD')$q$,'OWNER different-currency commission requires fresh MFA');
INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(:'project_id',:'supplier_company',50,'EUR');
SELECT set_config('request.jwt.claim.mfa_verified_at',extract(epoch FROM statement_timestamp())::text,true);
INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(:'project_id',:'supplier_company',10001,'EUR');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e006',true);
INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(:'project_id',:'supplier_company',50,'EUR');
SELECT pg_temp.denied($q$INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(current_setting('test.project_id')::uuid,current_setting('test.supplier_company')::uuid,200,'EUR')$q$,'commission limit enforced in PostgreSQL');
SELECT pg_temp.denied($q$INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(current_setting('test.project_id')::uuid,current_setting('test.supplier_company')::uuid,1,'USD')$q$,'unknown conversion currency requires approval');
SELECT sb.request_risk_approval('commissions.create',jsonb_build_object('projectId',:'project_id','partnerCompanyId',:'supplier_company','amount',200,'currency','EUR','agreementReference','','status','under_agreement')) AS risk_id \gset
SELECT set_config('test.risk_id',:'risk_id',true);
SELECT pg_temp.denied($q$SELECT sb.decide_risk_approval(current_setting('test.risk_id')::uuid,'approved')$q$,'requester cannot self-approve risk');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true);
SELECT set_config('request.jwt.claim.mfa_verified_at',(extract(epoch FROM statement_timestamp())-301)::text,true);
SELECT pg_temp.denied($q$SELECT sb.decide_risk_approval(current_setting('test.risk_id')::uuid,'approved')$q$,'high-risk owner approval requires fresh MFA');
SELECT set_config('request.jwt.claim.mfa_verified_at',extract(epoch FROM statement_timestamp())::text,true);
SELECT sb.decide_risk_approval(:'risk_id','approved');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e006',true),set_config('request.risk_approval_id',:'risk_id',true);
SELECT pg_temp.denied($q$INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(current_setting('test.project_id')::uuid,current_setting('test.supplier_company')::uuid,201,'EUR')$q$,'approval cannot authorize modified payload');
INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(:'project_id',:'supplier_company',200,'EUR');
SELECT pg_temp.denied($q$INSERT INTO sb.commissions(project_id,partner_company_id,amount,currency) VALUES(current_setting('test.project_id')::uuid,current_setting('test.supplier_company')::uuid,200,'EUR')$q$,'approval cannot be replayed');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true);
SELECT sb.suspend_account('00000000-0000-4000-8000-00000000e006','suspended');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e006',true);
SELECT pg_temp.assert_true(NOT sb.has_permission('commissions.read') AND NOT sb.is_staff(),'suspension immediately removes all staff rights');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e001',true);
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.audit_events WHERE resource='sb.staff_role_assignments' AND metadata->>'active'='false'),'role revocation audited');
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.audit_events WHERE resource='sb.staff_permission_overrides' AND metadata->>'effect'='deny'),'permission changes audited');
SELECT pg_temp.assert_true(EXISTS(SELECT FROM sb.audit_events WHERE resource='sb.risk_approvals' AND metadata->>'status'='consumed'),'independent risk approval consumption audited');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sb' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)),'all private tables enforce RLS');
ROLLBACK;
\echo 'PASS: seven staff roles, MFA freshness, direct SQL owner/auth protection, owner exclusivity, granular read/edit/approve, immediate revocation, multi-user Buyer/Supplier/Partner company isolation, exact independent risk approval, limits, suspension, audit'
