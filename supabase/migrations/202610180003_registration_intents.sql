-- An unauthenticated sign-up response is never sufficient proof of account ownership.
-- A short-lived opaque intent can be consumed only after independently verified Auth identity.
BEGIN;
CREATE TABLE sb.registration_intents (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), email text NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16000),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sb.registration_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.registration_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sb.registration_intents FROM PUBLIC,shadowbridge_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON sb.registration_intents TO shadowbridge_sessions;
CREATE POLICY intent_service ON sb.registration_intents FOR ALL TO shadowbridge_sessions USING(true) WITH CHECK(true);
CREATE INDEX registration_intents_expiry ON sb.registration_intents(expires_at);

CREATE OR REPLACE FUNCTION sb.submit_application(role text, company jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company_uuid uuid; application_uuid uuid;
BEGIN
 IF NOT sb.account_active(true) OR role NOT IN ('buyer','supplier','partner') THEN RAISE EXCEPTION 'Verified account required for application' USING ERRCODE='42501'; END IF;
 -- Lock the account to serialize simultaneous submissions/replayed intent consumption.
 PERFORM 1 FROM sb.accounts WHERE user_id=sb.user_id() FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sb.applications a WHERE a.user_id=sb.user_id()) THEN RAISE EXCEPTION 'An application already exists' USING ERRCODE='23505'; END IF;
 INSERT INTO sb.companies(legal_name,registration_number,country,created_by) VALUES(company->>'legal_name',company->>'registration_number',company->>'country',sb.user_id()) RETURNING id INTO company_uuid;
 INSERT INTO sb.applications(user_id,company_id,requested_role) VALUES(sb.user_id(),company_uuid,role) RETURNING id INTO application_uuid;
 INSERT INTO sb.memberships(user_id,company_id,role) VALUES(sb.user_id(),company_uuid,role);
 RETURN application_uuid;
END $$;
COMMIT;
