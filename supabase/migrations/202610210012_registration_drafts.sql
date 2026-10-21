-- Durable, identity-bound registration drafts. Existing accounts, applications
-- and legacy intents are retained unchanged; no retrospective role guessing.
BEGIN;

CREATE TABLE sb.registration_intakes (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 email text NOT NULL CHECK(email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16000
   AND payload ?& ARRAY['role','company','professional']
   AND jsonb_typeof(payload->'role')='string' AND payload->>'role' IN ('buyer','supplier','partner')
   AND jsonb_typeof(payload->'company')='object'
   AND jsonb_typeof(payload->'professional')='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sb.registration_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.registration_intakes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sb.registration_intakes FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
GRANT INSERT(token_hash,email,payload) ON sb.registration_intakes TO shadowbridge_sessions;
CREATE POLICY registration_intake_service_insert ON sb.registration_intakes FOR INSERT
 TO shadowbridge_sessions WITH CHECK(true);
GRANT SELECT ON sb.registration_intakes TO shadowbridge_policy;

CREATE TABLE sb.registration_drafts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL CHECK(email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16000
   AND payload ?& ARRAY['role','company','professional']
   AND jsonb_typeof(payload->'role')='string' AND payload->>'role' IN ('buyer','supplier','partner')
   AND jsonb_typeof(payload->'company')='object'
   AND jsonb_typeof(payload->'professional')='object'),
 intake_hash text UNIQUE REFERENCES sb.registration_intakes(token_hash),
 legacy_token_hash text CHECK(legacy_token_hash IS NULL OR legacy_token_hash ~ '^[a-f0-9]{64}$'),
 source text NOT NULL CHECK(source IN ('signup_nonce','legacy_selected','legacy_unambiguous')),
 created_at timestamptz NOT NULL DEFAULT now(),
 consumed_at timestamptz,
 CHECK((source='signup_nonce' AND intake_hash IS NOT NULL AND legacy_token_hash IS NULL)
   OR (source IN ('legacy_selected','legacy_unambiguous') AND intake_hash IS NULL AND legacy_token_hash IS NOT NULL))
);
ALTER TABLE sb.registration_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.registration_drafts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sb.registration_drafts FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
GRANT SELECT,INSERT,UPDATE ON sb.registration_drafts TO shadowbridge_policy;
GRANT SELECT ON sb.registration_intents TO shadowbridge_policy;
CREATE INDEX registration_intents_email ON sb.registration_intents(lower(btrim(email)));

-- Only a NEW Auth identity can capture its request's nonce. A repeated signup
-- can update provider metadata, but cannot replace this immutable draft.
CREATE FUNCTION sb.capture_registration_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE nonce text; intake sb.registration_intakes;
BEGIN
 nonce=new.raw_user_meta_data->>'sb_registration_intent';
 IF nonce IS NULL OR nonce !~ '^[a-f0-9]{64}$' OR new.email IS NULL THEN RETURN new; END IF;
 SELECT * INTO intake FROM sb.registration_intakes
 WHERE token_hash=encode(public.digest(nonce,'sha256'),'hex') AND email=lower(btrim(new.email));
 IF NOT FOUND THEN RETURN new; END IF;
 INSERT INTO sb.registration_drafts(user_id,email,payload,intake_hash,source)
 VALUES(new.id,intake.email,intake.payload,intake.token_hash,'signup_nonce')
 ON CONFLICT DO NOTHING;
 RETURN new;
END $$;
ALTER FUNCTION sb.capture_registration_draft() OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.capture_registration_draft() FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin;
-- PostgreSQL runs same-kind triggers alphabetically. The account sync trigger
-- precedes this one; capture itself requires only the new auth.users identity.
CREATE TRIGGER zz_shadowbridge_registration_capture AFTER INSERT ON auth.users
 FOR EACH ROW EXECUTE FUNCTION sb.capture_registration_draft();

CREATE FUNCTION sb.guard_registration_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF new.user_id IS DISTINCT FROM old.user_id OR new.email IS DISTINCT FROM old.email
   OR new.payload IS DISTINCT FROM old.payload OR new.intake_hash IS DISTINCT FROM old.intake_hash
   OR new.legacy_token_hash IS DISTINCT FROM old.legacy_token_hash OR new.source IS DISTINCT FROM old.source
   OR new.created_at IS DISTINCT FROM old.created_at
   OR old.consumed_at IS NOT NULL AND new.consumed_at IS DISTINCT FROM old.consumed_at THEN
  RAISE EXCEPTION 'Original registration draft is immutable' USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
ALTER FUNCTION sb.guard_registration_draft() OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.guard_registration_draft() FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin;
CREATE TRIGGER registration_draft_immutable BEFORE UPDATE ON sb.registration_drafts
 FOR EACH ROW EXECUTE FUNCTION sb.guard_registration_draft();

CREATE FUNCTION sb.registration_draft_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid=sb.user_id(); account_email text; draft sb.registration_drafts; choices jsonb;
BEGIN
 IF NOT sb.account_active(true) THEN
  RAISE EXCEPTION 'Verified active account required' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(email)) INTO account_email FROM sb.accounts WHERE user_id=subject;
 IF EXISTS(SELECT 1 FROM sb.applications WHERE user_id=subject) THEN
  RETURN jsonb_build_object('state','submitted');
 END IF;
 SELECT * INTO draft FROM sb.registration_drafts WHERE user_id=subject;
 IF FOUND THEN
  IF draft.email<>account_email THEN
   RAISE EXCEPTION 'Registration identity mismatch; management review required' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('state','ready','role',draft.payload->>'role',
   'company',draft.payload->'company','professional',draft.payload->'professional');
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',token_hash,'role',payload->>'role',
   'company',payload->'company','professional',payload->'professional',
   'createdAt',created_at,'expired',expires_at<=now()) ORDER BY created_at,token_hash)
 INTO choices FROM sb.registration_intents WHERE lower(btrim(email))=account_email;
 IF choices IS NOT NULL THEN RETURN jsonb_build_object('state','review_required','choices',choices); END IF;
 RETURN jsonb_build_object('state','missing');
END $$;
ALTER FUNCTION sb.registration_draft_state() OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.registration_draft_state() FROM PUBLIC,shadowbridge_sessions,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION sb.registration_draft_state() TO shadowbridge_api;

CREATE FUNCTION sb.consume_registration_draft(legacy_ref text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid=sb.user_id(); account_email text; draft sb.registration_drafts;
 legacy sb.registration_intents; distinct_payloads bigint; application_uuid uuid; company_uuid uuid;
BEGIN
 -- Serializes confirm/login/retry against this account and existing application.
 -- A status change that won the lock is checked again after acquiring it.
 PERFORM 1 FROM sb.accounts WHERE user_id=subject FOR UPDATE;
 IF NOT sb.account_active(true) THEN
  RAISE EXCEPTION 'Verified active account required' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(email)) INTO account_email FROM sb.accounts WHERE user_id=subject;
 IF EXISTS(SELECT 1 FROM sb.applications WHERE user_id=subject) THEN
  RETURN jsonb_build_object('state','submitted');
 END IF;
 SELECT * INTO draft FROM sb.registration_drafts WHERE user_id=subject FOR UPDATE;
 IF FOUND THEN
  IF legacy_ref IS NOT NULL THEN
   RAISE EXCEPTION 'Original registration draft is immutable' USING ERRCODE='42501';
  END IF;
 ELSE
  IF legacy_ref IS NOT NULL THEN
   IF legacy_ref !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid own registration reference' USING ERRCODE='22023';
   END IF;
   SELECT * INTO legacy FROM sb.registration_intents
    WHERE token_hash=legacy_ref AND lower(btrim(email))=account_email;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Own registration draft not found' USING ERRCODE='42501';
   END IF;
  ELSE
   -- An expired conflicting choice also prevents guessing the original role.
   SELECT count(DISTINCT payload) INTO distinct_payloads FROM sb.registration_intents
    WHERE lower(btrim(email))=account_email;
   IF distinct_payloads<>1 THEN RETURN sb.registration_draft_state(); END IF;
   SELECT * INTO legacy FROM sb.registration_intents
    WHERE lower(btrim(email))=account_email AND expires_at>now()
    ORDER BY created_at,token_hash LIMIT 1;
   IF NOT FOUND THEN RETURN sb.registration_draft_state(); END IF;
  END IF;
  INSERT INTO sb.registration_drafts(user_id,email,payload,legacy_token_hash,source)
   VALUES(subject,account_email,legacy.payload,legacy.token_hash,
    CASE WHEN legacy_ref IS NULL THEN 'legacy_unambiguous' ELSE 'legacy_selected' END)
   RETURNING * INTO draft;
  IF legacy_ref IS NOT NULL THEN
   INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata)
    VALUES(subject,'registration.legacy_selected','sb.registration_drafts',subject::text,
     jsonb_build_object('role',draft.payload->>'role','source',draft.source));
  END IF;
 END IF;
 IF draft.email<>account_email THEN
  RAISE EXCEPTION 'Registration identity mismatch; management review required' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM sb.professional_profiles WHERE user_id=subject) THEN
  RAISE EXCEPTION 'Existing company profile requires management review' USING ERRCODE='42501';
 END IF;
 application_uuid=sb.submit_application(draft.payload->>'role',draft.payload->'company');
 SELECT company_id INTO STRICT company_uuid FROM sb.applications WHERE id=application_uuid AND user_id=subject;
 INSERT INTO sb.professional_profiles(user_id,company_id,countries,sectors,summary)
 VALUES(subject,company_uuid,
  ARRAY(SELECT jsonb_array_elements_text(coalesce(draft.payload#>'{professional,countries}','[]'::jsonb))),
  ARRAY(SELECT jsonb_array_elements_text(coalesce(draft.payload#>'{professional,sectors}','[]'::jsonb))),
  coalesce(draft.payload#>>'{professional,summary}',''));
 UPDATE sb.registration_drafts SET consumed_at=clock_timestamp() WHERE user_id=subject;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata)
  VALUES(subject,'registration.application_submitted','sb.registration_drafts',subject::text,
   jsonb_build_object('role',draft.payload->>'role','source',draft.source));
 RETURN jsonb_build_object('state','submitted');
END $$;
ALTER FUNCTION sb.consume_registration_draft(text) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.consume_registration_draft(text) FROM PUBLIC,shadowbridge_sessions,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION sb.consume_registration_draft(text) TO shadowbridge_api;

COMMIT;
