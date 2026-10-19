-- Isolated real-PostgreSQL contact-intake/RLS test. Fixtures always roll back.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-00000000c901','contact.management@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000c902','contact.buyer@test.shadowbridge.invalid',now());
INSERT INTO sb.staff_grants(user_id,active) VALUES('00000000-0000-4000-8000-00000000c901',true);
SELECT encode(digest(gen_random_uuid()::text,'sha256'),'hex') AS client_key \gset
SELECT set_config('test.contact_client_key',:'client_key',true);
SET LOCAL ROLE shadowbridge_sessions;
SELECT sb.enqueue_contact('{"name":"FICTIONAL Contact","email":"contact.fixture@test.shadowbridge.invalid","company":"FICTIONAL Contact Company","role":"buyer","message":"Fictional local queue test; no real business information."}',:'client_key') AS receipt \gset
SELECT set_config('test.contact_receipt',:'receipt',true);
DO $$ BEGIN
 IF current_setting('test.contact_receipt') !~ '^SB-CONTACT-[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'Contact receipt is not anonymous'; END IF;
 BEGIN
  PERFORM 1 FROM sb.contact_enquiries;
  RAISE EXCEPTION 'Session role read confidential contact messages';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM 1 FROM sb.contact_rate_limits;
  RAISE EXCEPTION 'Session role accessed rate-limit keys';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO sb.contact_enquiries(name,email,role,message) VALUES('FICTIONAL','test@test.invalid','other','Must only use constrained RPC');
  RAISE EXCEPTION 'Session role bypassed contact RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM sb.enqueue_contact('{"name":"FICTIONAL","email":"test@test.invalid","role":"other","message":"Test invalid custom field","status":"replied"}',current_setting('test.contact_client_key'));
  RAISE EXCEPTION 'Contact RPC accepted forged status';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM sb.enqueue_contact('{"name":"FICTIONAL","email":"not-an-email","role":"other","message":"Test invalid e-mail field"}',current_setting('test.contact_client_key'));
  RAISE EXCEPTION 'Contact RPC accepted invalid e-mail';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 FOR counter IN 2..5 LOOP
  PERFORM sb.enqueue_contact('{"name":"FICTIONAL Limit","email":"limit@test.shadowbridge.invalid","role":"other","message":"Fictional rate-limit test submission"}',current_setting('test.contact_client_key'));
 END LOOP;
 BEGIN
  PERFORM sb.enqueue_contact('{"name":"FICTIONAL Limit","email":"limit@test.shadowbridge.invalid","role":"other","message":"Fictional rate-limit test submission"}',current_setting('test.contact_client_key'));
  RAISE EXCEPTION 'Contact limit did not hold';
 EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE shadowbridge_api;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.aal','',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.contact_enquiries) THEN RAISE EXCEPTION 'Anonymous principal read contact queue'; END IF;
 UPDATE sb.contact_enquiries SET status='closed';
 IF FOUND THEN RAISE EXCEPTION 'Anonymous principal modified contact queue'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c902',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.contact_enquiries) THEN RAISE EXCEPTION 'Buyer read contact queue'; END IF;
 UPDATE sb.contact_enquiries SET status='closed';
 IF FOUND THEN RAISE EXCEPTION 'Buyer modified contact queue'; END IF;
 BEGIN
  PERFORM sb.enqueue_contact('{"name":"FICTIONAL API","email":"api@test.invalid","role":"other","message":"Fictional direct API call"}',current_setting('test.contact_client_key'));
  RAISE EXCEPTION 'Business API role executed public-intake RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c901',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.contact_enquiries) THEN RAISE EXCEPTION 'Management read contact queue without MFA'; END IF;
 UPDATE sb.contact_enquiries SET status='closed';
 IF FOUND THEN RAISE EXCEPTION 'Management modified contact queue without MFA'; END IF;
END $$;
SELECT set_config('request.jwt.claim.aal','aal2',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.contact_enquiries WHERE public_id=current_setting('test.contact_receipt') AND status='new' AND email='contact.fixture@test.shadowbridge.invalid') THEN RAISE EXCEPTION 'Committed contact was not readable by MFA management'; END IF;
 UPDATE sb.contact_enquiries SET status='in_review' WHERE public_id=current_setting('test.contact_receipt');
 IF NOT EXISTS(SELECT FROM sb.contact_enquiries WHERE public_id=current_setting('test.contact_receipt') AND status='in_review' AND processed_by=sb.user_id() AND reviewed_at IS NOT NULL) THEN RAISE EXCEPTION 'Management review was not attributed'; END IF;
 BEGIN
  UPDATE sb.contact_enquiries SET message='Management must not rewrite the intake';
  RAISE EXCEPTION 'Management overwrote original enquiry';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT EXISTS(SELECT FROM sb.audit_events WHERE resource='sb.contact_enquiries' AND actor_id=sb.user_id() AND action='update' AND metadata->>'status'='in_review') THEN RAISE EXCEPTION 'Contact status change lacks audit event'; END IF;
 IF EXISTS(SELECT FROM sb.audit_events WHERE resource='sb.contact_enquiries' AND metadata::text ~ '(contact.fixture|Fictional local queue|FICTIONAL Contact Company)') THEN RAISE EXCEPTION 'Contact audit duplicated confidential intake fields'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sb' AND c.relname IN ('contact_enquiries','contact_rate_limits') AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Contact table lacks forced RLS'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='sb' AND p.proname='enqueue_contact' AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Public can execute intake RPC directly'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: real contact persistence, anonymous receipt, validation, rate limit, management MFA, immutable intake, private RLS and audit'
