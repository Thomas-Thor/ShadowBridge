-- Local isolated SQL authorization test. Requires a DBA test connection; always rolls back.
-- docker exec -i shadowbridge-private-local-postgres-1 psql -U postgres -d shadowbridge -v ON_ERROR_STOP=1 < supabase/tests/rls-smoke.sql
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-00000000d001','buyer.rls-smoke@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d002','supplier.rls-smoke@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d003','management.rls-smoke@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d004','pending.rls-smoke@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d005','buyer2.rls-smoke@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d006','unverified.rls-smoke@test.shadowbridge.invalid',NULL);
INSERT INTO sb.staff_grants(user_id,active) VALUES('00000000-0000-4000-8000-00000000d003',true);
SET LOCAL ROLE shadowbridge_api;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d001',true),set_config('request.jwt.claim.aal','aal1',true);
SELECT sb.submit_application('buyer','{"legal_name":"FICTIONAL Buyer RLS","registration_number":"TEST-BUYER-RLS","country":"NO"}') AS buyer_application \gset
SELECT company_id AS buyer_company FROM sb.applications WHERE id=:'buyer_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d002',true);
SELECT sb.submit_application('supplier','{"legal_name":"FICTIONAL Supplier RLS","registration_number":"TEST-SUPPLIER-RLS","country":"NO"}') AS supplier_application \gset
SELECT company_id AS supplier_company FROM sb.applications WHERE id=:'supplier_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d005',true);
SELECT sb.submit_application('buyer','{"legal_name":"FICTIONAL Buyer Two RLS","registration_number":"TEST-BUYER2-RLS","country":"NO"}') AS buyer2_application \gset
SELECT company_id AS buyer2_company FROM sb.applications WHERE id=:'buyer2_application' \gset
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d006',true);
DO $$ BEGIN
 BEGIN
  PERFORM sb.submit_application('buyer','{"legal_name":"Unverified","registration_number":"TEST-NOT-ALLOWED","country":"NO"}');
  RAISE EXCEPTION 'Unverified applicant accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d004',true);
SELECT sb.submit_application('buyer','{"legal_name":"FICTIONAL Pending RLS","registration_number":"TEST-PENDING-RLS","country":"NO"}') AS pending_application \gset
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.applications WHERE user_id=sb.user_id() AND status='pending') THEN RAISE EXCEPTION 'Pending account cannot read own application'; END IF;
 IF EXISTS(SELECT FROM sb.offers) THEN RAISE EXCEPTION 'Pending account can read business offers'; END IF;
 BEGIN
  UPDATE sb.memberships SET status='approved' WHERE user_id=sb.user_id();
  RAISE EXCEPTION 'Membership self-approval unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d003',true);
DO $$ BEGIN
 IF NOT sb.has_staff_grant() THEN RAISE EXCEPTION 'MFA enrollment cannot discover own management grant'; END IF;
 IF sb.is_staff() THEN RAISE EXCEPTION 'Management accepted aal1'; END IF;
 BEGIN
  PERFORM sb.decide_application((SELECT id FROM sb.applications LIMIT 1),'approved','');
  RAISE EXCEPTION 'Management operation accepted aal1';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.aal','aal2',true);
SELECT sb.decide_application(:'buyer_application','approved','FICTIONAL SQL test');
SELECT sb.decide_application(:'supplier_application','approved','FICTIONAL SQL test');
SELECT sb.decide_application(:'buyer2_application','approved','FICTIONAL SQL test');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d002',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.offers(company_id,created_by,data,status) VALUES(:'supplier_company','00000000-0000-4000-8000-00000000d002','{"title":"FICTIONAL Industrial material"}','submitted') RETURNING id AS source_offer,public_id AS source_public_id \gset
DO $$ BEGIN
 BEGIN
  UPDATE sb.offers SET status='approved';
  -- RLS legitimately affects zero submitted rows: permission is denied by visibility.
  IF FOUND THEN RAISE EXCEPTION 'Supplier approved its own offer'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d001',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.offers) THEN RAISE EXCEPTION 'Buyer saw supplier source offer'; END IF;
 IF EXISTS(SELECT FROM sb.companies WHERE created_by<>'00000000-0000-4000-8000-00000000d001') THEN RAISE EXCEPTION 'Buyer saw counterparty company'; END IF;
 IF EXISTS(SELECT FROM sb.opportunity_sources) THEN RAISE EXCEPTION 'Buyer saw private source mappings'; END IF;
END $$;
-- A buyer may not impersonate a supplier company even with known UUIDs.
SELECT set_config('test.supplier_company',:'supplier_company',true);
DO $$ BEGIN
 BEGIN
  INSERT INTO sb.offers(company_id,created_by,data) VALUES(current_setting('test.supplier_company')::uuid,sb.user_id(),'{}');
  RAISE EXCEPTION 'Forged company offer insertion succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d003',true),set_config('request.jwt.claim.aal','aal2',true);
UPDATE sb.offers SET status='approved' WHERE id=:'source_offer';
SELECT sb.publish_opportunity(:'source_offer','{"title":"FICTIONAL Industrial material","specification":"Commercial terms through ShadowBridge","quantity":20,"price":42,"unit":"tonnes"}') AS opportunity_id \gset
SELECT sb.grant_opportunity(:'opportunity_id',:'buyer_company','buyer',NULL);
SELECT sb.grant_opportunity(:'opportunity_id',:'buyer2_company','buyer',NULL);
DO $$ BEGIN
 BEGIN
  UPDATE portal.opportunities SET data='{"title":"Bypass review"}';
  RAISE EXCEPTION 'Approved card data bypassed publication review';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM sb.record_auth_event(sb.user_id(),'login');
  RAISE EXCEPTION 'API role forged an authentication event';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('test.source_offer',:'source_offer',true);
DO $$ BEGIN
 BEGIN
  PERFORM sb.publish_opportunity(current_setting('test.source_offer')::uuid,'{"title":"Contact supplier@example.invalid"}');
  RAISE EXCEPTION 'Anonymous card accepted an e-mail';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Contact information is forbidden in anonymous cards' THEN RAISE; END IF;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d001',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.messages(resource_type,resource_public_id,sender_user_id,body) VALUES('opportunity',:'opportunity_id',sb.user_id(),'FICTIONAL Buyer One confidential enquiry');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d005',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.messages) THEN RAISE EXCEPTION 'Second buyer read first buyer opportunity enquiry'; END IF;
END $$;
INSERT INTO sb.messages(resource_type,resource_public_id,sender_user_id,body) VALUES('opportunity',:'opportunity_id',sb.user_id(),'FICTIONAL Buyer Two confidential enquiry');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d003',true),set_config('request.jwt.claim.aal','aal2',true);
INSERT INTO sb.messages(resource_type,resource_public_id,company_id,sender_user_id,body) VALUES('opportunity',:'opportunity_id',:'buyer_company',sb.user_id(),'FICTIONAL ShadowBridge reply only for Buyer One');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d001',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM portal.opportunities)<>1 THEN RAISE EXCEPTION 'Explicit opportunity grant failed'; END IF;
 IF EXISTS(SELECT FROM sb.offers) OR EXISTS(SELECT FROM sb.opportunity_sources) THEN RAISE EXCEPTION 'Anonymous opportunity exposed sources'; END IF;
 IF (SELECT count(*) FROM sb.messages)<>2 OR EXISTS(SELECT FROM sb.messages WHERE body LIKE '%Buyer Two%') THEN RAISE EXCEPTION 'Company correspondence crossed an opportunity recipient boundary'; END IF;
 BEGIN
  INSERT INTO sb.audit_events(action,resource) VALUES('fake','fake');
  RAISE EXCEPTION 'Business user forged an audit event';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM 1 FROM sb.registration_intents;
  RAISE EXCEPTION 'API role accessed registration intent payloads';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM 1 FROM sb.sessions;
  RAISE EXCEPTION 'API role accessed session tokens';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d003',true),set_config('request.jwt.claim.aal','aal2',true);
UPDATE sb.accounts SET status='suspended' WHERE user_id='00000000-0000-4000-8000-00000000d001';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d001',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM portal.opportunities) THEN RAISE EXCEPTION 'Suspended account kept access'; END IF;
 IF EXISTS(SELECT FROM sb.rfqs) THEN RAISE EXCEPTION 'Suspended account kept RFQ access'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE shadowbridge_sessions;
SELECT sb.record_auth_event('00000000-0000-4000-8000-00000000d001','login');
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM sb.companies;
  RAISE EXCEPTION 'Session role accessed company identities';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM sb.record_auth_event('00000000-0000-4000-8000-00000000d001','application.approved');
  RAISE EXCEPTION 'Session role forged a management activity';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('sb','portal') AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'A private table lacks forced RLS'; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN('shadowbridge_api','shadowbridge_sessions') AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Runtime role can bypass RLS'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: verification, pending/approval, aal2, tenant/company message isolation, source privacy, explicit grants, suspension, audit/session/intent separation'
