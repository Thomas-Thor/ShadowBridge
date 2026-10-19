BEGIN;
-- Public contact is an intake queue, never a registration, offer or CRM import.
-- The browser receives only an unpredictable receipt. All identity fields stay
-- behind the management policy; the BFF's session role cannot read this table.
CREATE TABLE sb.contact_enquiries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 public_id text NOT NULL UNIQUE DEFAULT ('SB-CONTACT-'||gen_random_uuid()::text),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
 company text NOT NULL DEFAULT '' CHECK(length(company)<=200),
 role text NOT NULL CHECK(role IN ('buyer','supplier','partner','other')),
 message text NOT NULL CHECK(length(message) BETWEEN 20 AND 5000),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_review','replied','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 processed_by uuid REFERENCES sb.accounts(user_id)
);
CREATE INDEX contact_enquiries_pending ON sb.contact_enquiries(status,created_at);

-- Only a server-keyed HMAC digest is accepted: neither an IP address nor a
-- browser-provided identity is persisted for throttling. Buckets are transient.
CREATE TABLE sb.contact_rate_limits (
 client_key text NOT NULL CHECK(client_key='global' OR client_key ~ '^[a-f0-9]{64}$'),
 window_started_at timestamptz NOT NULL,
 submissions integer NOT NULL CHECK(submissions BETWEEN 1 AND 200),
 PRIMARY KEY(client_key,window_started_at)
);
CREATE INDEX contact_rate_limits_expiry ON sb.contact_rate_limits(window_started_at);
ALTER TABLE sb.contact_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.contact_enquiries FORCE ROW LEVEL SECURITY;
ALTER TABLE sb.contact_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.contact_rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_management_read ON sb.contact_enquiries FOR SELECT TO shadowbridge_api USING(sb.is_staff());
CREATE POLICY contact_management_status ON sb.contact_enquiries FOR UPDATE TO shadowbridge_api USING(sb.is_staff()) WITH CHECK(sb.is_staff());
GRANT SELECT ON sb.contact_enquiries TO shadowbridge_api;
GRANT UPDATE(status) ON sb.contact_enquiries TO shadowbridge_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON sb.contact_enquiries,sb.contact_rate_limits TO shadowbridge_policy;

CREATE FUNCTION sb.enqueue_contact(payload jsonb, client_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 receipt text;
 bucket timestamptz=to_timestamp(floor(extract(epoch FROM clock_timestamp())/900)*900);
 item record;
 counter integer;
BEGIN
 IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('name','email','company','role','message')) OR
    NOT payload ?& ARRAY['name','email','role','message'] THEN
  RAISE EXCEPTION 'Invalid contact fields' USING ERRCODE='22023';
 END IF;
 FOR item IN SELECT * FROM jsonb_each(payload) LOOP
  IF jsonb_typeof(item.value)<>'string' THEN RAISE EXCEPTION 'Contact fields must be text' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF client_key IS NULL OR client_key !~ '^[a-f0-9]{64}$' OR
    length(btrim(payload->>'name')) NOT BETWEEN 2 AND 120 OR
    length(btrim(payload->>'email')) NOT BETWEEN 3 AND 254 OR
    btrim(payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR
    length(btrim(coalesce(payload->>'company',''))) > 200 OR
    payload->>'role' NOT IN ('buyer','supplier','partner','other') OR
    length(btrim(payload->>'message')) NOT BETWEEN 20 AND 5000 OR
    (payload->>'name') ~ '[[:cntrl:]]' OR
    coalesce(payload->>'company','') ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Invalid contact fields' USING ERRCODE='22023';
 END IF;

 -- Atomic upserts make the limits hold across simultaneous BFF workers. The
 -- exception rolls back both counters and the intake if either limit is hit.
 DELETE FROM sb.contact_rate_limits r WHERE r.window_started_at < bucket-interval '1 day';
 INSERT INTO sb.contact_rate_limits AS r(client_key,window_started_at,submissions)
 VALUES(client_key,bucket,1)
 ON CONFLICT ON CONSTRAINT contact_rate_limits_pkey DO UPDATE
 SET submissions=r.submissions+1 WHERE r.submissions<5 RETURNING submissions INTO counter;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contact submission limit reached' USING ERRCODE='54000'; END IF;
 INSERT INTO sb.contact_rate_limits AS r(client_key,window_started_at,submissions)
 VALUES('global',bucket,1)
 ON CONFLICT ON CONSTRAINT contact_rate_limits_pkey DO UPDATE
 SET submissions=r.submissions+1 WHERE r.submissions<200 RETURNING submissions INTO counter;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contact submission limit reached' USING ERRCODE='54000'; END IF;

 INSERT INTO sb.contact_enquiries(name,email,company,role,message)
 VALUES(btrim(payload->>'name'),lower(btrim(payload->>'email')),btrim(coalesce(payload->>'company','')),payload->>'role',btrim(payload->>'message'))
 RETURNING public_id INTO receipt;
 RETURN receipt;
END $$;
ALTER FUNCTION sb.enqueue_contact(jsonb,text) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.enqueue_contact(jsonb,text) FROM PUBLIC,shadowbridge_api;
GRANT EXECUTE ON FUNCTION sb.enqueue_contact(jsonb,text) TO shadowbridge_sessions;

CREATE FUNCTION sb.contact_status_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.is_staff() THEN RAISE EXCEPTION 'Management MFA required' USING ERRCODE='42501'; END IF;
 IF (to_jsonb(new)-ARRAY['status','reviewed_at','processed_by']) IS DISTINCT FROM
    (to_jsonb(old)-ARRAY['status','reviewed_at','processed_by']) THEN
  RAISE EXCEPTION 'Contact intake is immutable' USING ERRCODE='42501';
 END IF;
 new.reviewed_at=CASE WHEN new.status IS DISTINCT FROM old.status THEN now() ELSE old.reviewed_at END;
 new.processed_by=CASE WHEN new.status IS DISTINCT FROM old.status THEN sb.user_id() ELSE old.processed_by END;
 RETURN new;
END $$;
ALTER FUNCTION sb.contact_status_update() OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.contact_status_update() FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
CREATE TRIGGER contact_status_update BEFORE UPDATE ON sb.contact_enquiries
 FOR EACH ROW EXECUTE FUNCTION sb.contact_status_update();
-- Existing audit function records only ID/status/actor, never message or email.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON sb.contact_enquiries
 FOR EACH ROW EXECUTE FUNCTION sb.audit_change();
COMMIT;
