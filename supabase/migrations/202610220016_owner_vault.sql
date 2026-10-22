-- OWNER VAULT V1. No backfill/import of platform companies, users or private CRM.
-- Principals have NOLOGIN; external ingestion is not activated by this migration.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('shadowbridge_vault_executor','shadowbridge_vault_ingest'))
    OR EXISTS(SELECT FROM pg_namespace WHERE nspname='owner_vault') THEN
  RAISE EXCEPTION 'Reserved Vault namespace or role exists; administrative review required' USING ERRCODE='42501';
 END IF;
 CREATE ROLE shadowbridge_vault_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 CREATE ROLE shadowbridge_vault_ingest NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
END $$;
CREATE SCHEMA owner_vault;
REVOKE ALL ON SCHEMA owner_vault FROM PUBLIC;
GRANT USAGE ON SCHEMA owner_vault TO shadowbridge_api,shadowbridge_vault_executor,shadowbridge_vault_ingest;
GRANT USAGE ON SCHEMA sb TO shadowbridge_vault_executor;
GRANT EXECUTE ON FUNCTION sb.is_owner(),sb.user_id(),sb.require_fresh_owner_mfa() TO shadowbridge_vault_executor;

CREATE TABLE owner_vault.agents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL CHECK(length(label) BETWEEN 2 AND 100),
 source_system text NOT NULL CHECK(source_system ~ '^[a-z][a-z0-9_-]{1,39}$'),
 database_role name NOT NULL UNIQUE, active boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE owner_vault.companies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 200),
 country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'), registration_number text NOT NULL DEFAULT '' CHECK(length(registration_number)<=100),
 sector text NOT NULL DEFAULT '' CHECK(length(sector)<=200), website text NOT NULL DEFAULT '' CHECK(length(website)<=500),
 verification_status text NOT NULL DEFAULT 'unconfirmed' CHECK(verification_status IN ('unconfirmed','confirmed','review_required')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vault_company_registry ON owner_vault.companies(country,registration_number) WHERE registration_number<>'';
CREATE TABLE owner_vault.contacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES owner_vault.companies(id),
 full_name text NOT NULL CHECK(length(full_name) BETWEEN 2 AND 200), title text NOT NULL DEFAULT '' CHECK(length(title)<=200),
 work_email text NOT NULL DEFAULT '' CHECK(length(work_email)<=254),
 email_kind text NOT NULL DEFAULT 'unknown' CHECK(email_kind IN ('individual','shared','unknown')),
 professional_url text NOT NULL DEFAULT '' CHECK(length(professional_url)<=500),
 verification_status text NOT NULL DEFAULT 'unconfirmed' CHECK(verification_status IN ('unconfirmed','confirmed','review_required')),
 source_system text NOT NULL, source_record_id text NOT NULL, source_url text NOT NULL DEFAULT '',
 agent_id uuid REFERENCES owner_vault.agents(id), added_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE INDEX vault_contact_page ON owner_vault.contacts(created_at DESC,id DESC);
CREATE INDEX vault_contact_company ON owner_vault.contacts(company_id);
CREATE TABLE owner_vault.identity_keys(
 kind text NOT NULL CHECK(kind IN ('source','professional','email_company')), key text NOT NULL CHECK(length(key)<=800),
 contact_id uuid NOT NULL REFERENCES owner_vault.contacts(id), PRIMARY KEY(kind,key)
);
CREATE TABLE owner_vault.intakes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid REFERENCES owner_vault.agents(id),
 actor_id uuid, request_key uuid NOT NULL, payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=16000),
 status text NOT NULL CHECK(status IN ('accepted','duplicate_prevented','review_required')),
 contact_id uuid REFERENCES owner_vault.contacts(id), candidates uuid[] NOT NULL DEFAULT '{}',
 reason_code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((agent_id IS NULL)<>(actor_id IS NULL))
);
CREATE UNIQUE INDEX vault_agent_retry ON owner_vault.intakes(agent_id,request_key) WHERE agent_id IS NOT NULL;
CREATE UNIQUE INDEX vault_owner_retry ON owner_vault.intakes(actor_id,request_key) WHERE actor_id IS NOT NULL;
CREATE TABLE owner_vault.events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action text NOT NULL,
 actor_id uuid, agent_id uuid, resource_id uuid, reason_code text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX vault_event_page ON owner_vault.events(id DESC);

-- SQL workers cannot become the executor or call OWNER functions. Only the
-- designated SECURITY DEFINER functions run as executor. No raw API table reads:
-- even an OWNER must use audited functions. No grant to shadowbridge_policy.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['agents','companies','contacts','identity_keys','intakes','events'] LOOP
  EXECUTE format('ALTER TABLE owner_vault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE owner_vault.%I FORCE ROW LEVEL SECURITY',t);
  -- Owner check is duplicated by every callable read/write function.
  -- For the ingestion executor, the function additionally binds session_user
  -- to a single enabled agent before doing any candidate lookup.
  EXECUTE format('CREATE POLICY vault_owner_select ON owner_vault.%I FOR SELECT TO shadowbridge_api USING(sb.is_owner())',t);
  EXECUTE format('CREATE POLICY vault_executor_read ON owner_vault.%I FOR SELECT TO shadowbridge_vault_executor USING(sb.is_owner() OR pg_catalog.pg_has_role(session_user,''shadowbridge_vault_ingest'',''member''))',t);
  EXECUTE format('CREATE POLICY vault_executor_insert ON owner_vault.%I FOR INSERT TO shadowbridge_vault_executor WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY vault_owner_update ON owner_vault.contacts FOR UPDATE TO shadowbridge_vault_executor USING(sb.is_owner()) WITH CHECK(sb.is_owner());
REVOKE ALL ON ALL TABLES IN SCHEMA owner_vault FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,shadowbridge_policy,shadowbridge_sentinel,shadowbridge_vault_ingest;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA owner_vault TO shadowbridge_vault_executor;
GRANT UPDATE(verification_status,updated_at,version) ON owner_vault.contacts TO shadowbridge_vault_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA owner_vault TO shadowbridge_vault_executor;

CREATE FUNCTION owner_vault.immutable_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Vault history is append-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER vault_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_vault.events FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history();
CREATE TRIGGER vault_intakes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_vault.intakes FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history();

CREATE FUNCTION owner_vault.require_owner(fresh boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT coalesce(sb.is_owner(),false) THEN RAISE EXCEPTION 'Owner Vault access denied' USING ERRCODE='42501'; END IF;
 IF fresh THEN PERFORM sb.require_fresh_owner_mfa(); END IF;
END $$;
-- Returns a denial rather than raising, so the HTTP transaction can commit its
-- minimal audit event before replying 403. It accepts no user-supplied data.
CREATE FUNCTION owner_vault.check_access() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(sb.is_owner(),false) THEN RETURN true; END IF;
 INSERT INTO owner_vault.events(action,actor_id,reason_code) VALUES('access.denied',sb.user_id(),'owner_mfa_required');
 RETURN false;
END $$;
CREATE FUNCTION owner_vault.record_failure(reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF reason IS NULL OR reason NOT IN ('invalid_input','not_allowed','rate_limit','storage_error') THEN RAISE EXCEPTION 'Invalid audit reason' USING ERRCODE='22023'; END IF;
 INSERT INTO owner_vault.events(action,actor_id,reason_code) VALUES('operation.failed',sb.user_id(),reason);
END $$;

-- Validation is repeated in SQL: a future ingestion login never bypasses the
-- HTTP validator. No URL is fetched and no person is matched by name alone.
CREATE FUNCTION owner_vault.validate_intake(p jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c jsonb; b jsonb; s jsonb; k text;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>16000
  OR NOT p ?& ARRAY['contact','company','source'] THEN RAISE EXCEPTION 'Invalid Vault intake' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP IF k NOT IN ('contact','company','source') THEN RAISE EXCEPTION 'Invalid Vault field' USING ERRCODE='22023'; END IF; END LOOP;
 c=p->'contact';b=p->'company';s=p->'source';
 IF jsonb_typeof(c)<>'object' OR jsonb_typeof(b)<>'object' OR jsonb_typeof(s)<>'object' THEN RAISE EXCEPTION 'Invalid Vault sections' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(c) LOOP
  IF k NOT IN ('fullName','title','workEmail','emailKind','professionalUrl') OR jsonb_typeof(c->k)<>'string' THEN RAISE EXCEPTION 'Invalid contact field' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(b) LOOP
  IF k NOT IN ('name','country','registrationNumber','sector','website') OR jsonb_typeof(b->k)<>'string' THEN RAISE EXCEPTION 'Invalid company field' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(s) LOOP
  IF k NOT IN ('system','recordId','url') OR jsonb_typeof(s->k)<>'string' THEN RAISE EXCEPTION 'Invalid source field' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF coalesce(length(btrim(c->>'fullName')),0) NOT BETWEEN 2 AND 200 OR coalesce(length(btrim(b->>'name')),0) NOT BETWEEN 2 AND 200
  OR coalesce(b->>'country','') !~ '^[A-Z]{2}$' OR coalesce(s->>'system','') !~ '^[a-z][a-z0-9_-]{1,39}$'
  OR coalesce(length(btrim(s->>'recordId')),0) NOT BETWEEN 1 AND 200
  OR length(coalesce(c->>'title',''))>200 OR length(coalesce(b->>'sector',''))>200 OR length(coalesce(b->>'registrationNumber',''))>100
  OR coalesce(c->>'emailKind','unknown') NOT IN ('individual','shared','unknown')
  OR length(coalesce(c->>'workEmail',''))>254
  OR (coalesce(c->>'workEmail','')<>'' AND (c->>'workEmail') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
  RAISE EXCEPTION 'Invalid Vault values' USING ERRCODE='22023';
 END IF;
 FOREACH k IN ARRAY ARRAY[coalesce(c->>'professionalUrl',''),coalesce(b->>'website',''),coalesce(s->>'url','')] LOOP
  IF length(k)>500 OR (k<>'' AND (k !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' OR k ~ '[<>"\\?#]')) THEN RAISE EXCEPTION 'Invalid source URL' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION owner_vault.individual_email(c jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(c->>'emailKind'='individual' AND coalesce(c->>'workEmail','')<>''
  AND split_part(lower(c->>'workEmail'),'@',1) !~ '^(info|sales|contact|office|hello|support|admin|orders|accounts|team|export|import|service)([+._-].*)?$',false)
$$;

-- Not callable by API/worker directly. Serialization and unique keys ensure
-- races cannot create duplicate contacts. Receipt retries are payload-bound.
CREATE FUNCTION owner_vault.save_intake(p jsonb,request_id uuid,agent uuid,actor uuid) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE existing owner_vault.intakes; company_uuid uuid; contact_uuid uuid; candidate_ids uuid[]; matched owner_vault.contacts;
 source_key text; profile_key text; email_key text; registry text; receipt uuid; outcome text; why text; digest text;
BEGIN
 PERFORM owner_vault.validate_intake(p);
 IF request_id IS NULL THEN RAISE EXCEPTION 'Request key required' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('shadowbridge-owner-vault-intake'));
 digest=encode(public.digest(p::text,'sha256'),'hex');
 SELECT * INTO existing FROM owner_vault.intakes WHERE request_key=request_id AND agent_id IS NOT DISTINCT FROM agent AND actor_id IS NOT DISTINCT FROM actor;
 IF FOUND THEN
  IF existing.payload_hash<>digest THEN RAISE EXCEPTION 'Request key was already used' USING ERRCODE='22023'; END IF;
  RETURN existing.id;
 END IF;
 IF agent IS NOT NULL AND (SELECT count(*) FROM owner_vault.intakes WHERE agent_id=agent AND created_at>now()-interval '5 minutes')>=60 THEN
  RAISE EXCEPTION 'Vault intake limit reached' USING ERRCODE='54000';
 END IF;
 registry=upper(btrim(coalesce(p#>>'{company,registrationNumber}','')));
 IF registry<>'' THEN SELECT id INTO company_uuid FROM owner_vault.companies WHERE country=p#>>'{company,country}' AND registration_number=registry; END IF;
 source_key=(p#>>'{source,system}')||':'||(p#>>'{source,recordId}');
 profile_key=rtrim(coalesce(p#>>'{contact,professionalUrl}',''),'/');
 IF company_uuid IS NOT NULL AND owner_vault.individual_email(p->'contact') THEN
  email_key=lower(p#>>'{contact,workEmail}')||':'||company_uuid::text;
 END IF;
 SELECT coalesce(array_agg(DISTINCT contact_id),'{}'::uuid[]) INTO candidate_ids FROM owner_vault.identity_keys
  WHERE (kind='source' AND key=source_key) OR (kind='professional' AND profile_key<>'' AND key=profile_key) OR (kind='email_company' AND key=email_key);
 IF cardinality(candidate_ids)>1 THEN outcome='review_required';why='conflicting_identity_keys';
 ELSIF cardinality(candidate_ids)=1 THEN
  SELECT * INTO STRICT matched FROM owner_vault.contacts WHERE id=candidate_ids[1];
  -- A stable key plus conflicting company/name/email evidence is a review,
  -- never an automatic employer change or replacement of the old record.
  IF company_uuid IS NULL OR matched.company_id<>company_uuid
   OR lower(matched.full_name)<>lower(btrim(p#>>'{contact,fullName}'))
   OR (matched.work_email<>'' AND coalesce(p#>>'{contact,workEmail}','')<>'' AND lower(matched.work_email)<>lower(p#>>'{contact,workEmail}')) THEN
   outcome='review_required';why='identity_details_changed';
  ELSE outcome='duplicate_prevented';why='strong_identity_match';contact_uuid=matched.id; END IF;
 ELSE
  IF company_uuid IS NULL THEN
   INSERT INTO owner_vault.companies(name,country,registration_number,sector,website)
    VALUES(btrim(p#>>'{company,name}'),p#>>'{company,country}',registry,coalesce(p#>>'{company,sector}',''),coalesce(p#>>'{company,website}','')) RETURNING id INTO company_uuid;
  END IF;
  INSERT INTO owner_vault.contacts(company_id,full_name,title,work_email,email_kind,professional_url,source_system,source_record_id,source_url,agent_id,added_by)
   VALUES(company_uuid,btrim(p#>>'{contact,fullName}'),coalesce(p#>>'{contact,title}',''),lower(coalesce(p#>>'{contact,workEmail}','')),
    coalesce(p#>>'{contact,emailKind}','unknown'),profile_key,p#>>'{source,system}',p#>>'{source,recordId}',coalesce(p#>>'{source,url}',''),agent,actor) RETURNING id INTO contact_uuid;
  outcome='accepted';why='new_record';
 END IF;
 IF contact_uuid IS NOT NULL THEN
  INSERT INTO owner_vault.identity_keys VALUES('source',source_key,contact_uuid) ON CONFLICT DO NOTHING;
  IF profile_key<>'' THEN INSERT INTO owner_vault.identity_keys VALUES('professional',profile_key,contact_uuid) ON CONFLICT DO NOTHING; END IF;
  IF owner_vault.individual_email(p->'contact') THEN
   INSERT INTO owner_vault.identity_keys VALUES('email_company',lower(p#>>'{contact,workEmail}')||':'||company_uuid::text,contact_uuid) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 INSERT INTO owner_vault.intakes(agent_id,actor_id,request_key,payload_hash,payload,status,contact_id,candidates,reason_code)
  VALUES(agent,actor,request_id,digest,p,outcome,contact_uuid,candidate_ids,why) RETURNING id INTO receipt;
 INSERT INTO owner_vault.events(action,actor_id,agent_id,resource_id,reason_code) VALUES('intake.'||outcome,actor,agent,receipt,why);
 RETURN receipt;
END $$;

CREATE FUNCTION owner_vault.owner_intake(p jsonb,request_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM owner_vault.require_owner(true);
 RETURN owner_vault.save_intake(p,request_id,NULL,sb.user_id());
END $$;
-- For a future dedicated DB login: no SELECT, match flags, counts, CRM IDs,
-- account access, grants or review functions. Only a random intake receipt.
CREATE FUNCTION owner_vault.ingest(p jsonb,request_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents;
BEGIN
 IF NOT pg_catalog.pg_has_role(session_user,'shadowbridge_vault_ingest','member') THEN RAISE EXCEPTION 'Agent access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM owner_vault.agents WHERE database_role=session_user AND active;
 IF NOT FOUND OR p#>>'{source,system}' IS DISTINCT FROM a.source_system THEN RAISE EXCEPTION 'Agent access denied' USING ERRCODE='42501'; END IF;
 RETURN owner_vault.save_intake(p,request_id,a.id,NULL);
END $$;

CREATE FUNCTION owner_vault.read_records(section text,query_text text DEFAULT '',record_status text DEFAULT '',page_number integer DEFAULT 1,page_size integer DEFAULT 25,record_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; total bigint; items jsonb; table_name text;
BEGIN
 PERFORM owner_vault.require_owner();
 IF section NOT IN ('contacts','companies','intakes','events') OR query_text IS NULL OR length(query_text)>100
  OR page_number IS NULL OR page_number NOT BETWEEN 1 AND 10000 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 50
  OR record_status IS NULL OR record_status NOT IN ('','unconfirmed','confirmed','review_required','accepted','duplicate_prevented') THEN
  RAISE EXCEPTION 'Invalid Vault filter' USING ERRCODE='22023';
 END IF;
 IF section='contacts' THEN
  SELECT count(*) INTO total FROM owner_vault.contacts c JOIN owner_vault.companies b ON b.id=c.company_id
   WHERE (record_id IS NULL OR c.id=record_id) AND (record_status='' OR c.verification_status=record_status)
   AND (query_text='' OR strpos(lower(c.full_name||' '||c.work_email||' '||b.name),lower(query_text))>0);
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO items FROM (
   SELECT c.*,b.name AS company_name,b.country,b.sector FROM owner_vault.contacts c JOIN owner_vault.companies b ON b.id=c.company_id
   WHERE (record_id IS NULL OR c.id=record_id) AND (record_status='' OR c.verification_status=record_status)
   AND (query_text='' OR strpos(lower(c.full_name||' '||c.work_email||' '||b.name),lower(query_text))>0)
   ORDER BY c.created_at DESC,c.id DESC LIMIT page_size OFFSET (page_number-1)*page_size) x;
 ELSIF section='companies' THEN
  SELECT count(*) INTO total FROM owner_vault.companies WHERE (record_id IS NULL OR id=record_id) AND (record_status='' OR verification_status=record_status) AND (query_text='' OR strpos(lower(name),lower(query_text))>0);
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO items FROM (SELECT * FROM owner_vault.companies WHERE (record_id IS NULL OR id=record_id) AND (record_status='' OR verification_status=record_status) AND (query_text='' OR strpos(lower(name),lower(query_text))>0) ORDER BY created_at DESC,id DESC LIMIT page_size OFFSET (page_number-1)*page_size) x;
 ELSIF section='intakes' THEN
  SELECT count(*) INTO total FROM owner_vault.intakes WHERE (record_status='' OR status=record_status) AND (record_id IS NULL OR id=record_id);
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO items FROM (SELECT * FROM owner_vault.intakes WHERE (record_status='' OR status=record_status) AND (record_id IS NULL OR id=record_id) ORDER BY created_at DESC,id DESC LIMIT page_size OFFSET (page_number-1)*page_size) x;
 ELSE
  SELECT count(*) INTO total FROM owner_vault.events;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO items FROM (SELECT * FROM owner_vault.events ORDER BY id DESC LIMIT page_size OFFSET (page_number-1)*page_size) x;
 END IF;
 INSERT INTO owner_vault.events(action,actor_id,resource_id,reason_code) VALUES('read.'||section,sb.user_id(),record_id,'audited_read');
 RETURN jsonb_build_object('items',items,'total',total,'page',page_number,'limit',page_size);
END $$;

CREATE FUNCTION owner_vault.statistics(at_time timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE local_time timestamp; end_day date; window_end timestamptz; window_start timestamptz; result jsonb;
BEGIN
 PERFORM owner_vault.require_owner();
 IF at_time IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
 local_time=at_time AT TIME ZONE 'Europe/Oslo';
 end_day=local_time::date-CASE WHEN local_time::time<time '08:00' THEN 1 ELSE 0 END;
 window_end=(end_day+time '08:00') AT TIME ZONE 'Europe/Oslo';
 window_start=((end_day-1)+time '18:00') AT TIME ZONE 'Europe/Oslo';
 SELECT jsonb_build_object('contacts',(SELECT count(*) FROM owner_vault.contacts),
  'companies',(SELECT count(*) FROM owner_vault.companies),
  'newContactsOvernight',(SELECT count(*) FROM owner_vault.contacts WHERE created_at>=window_start AND created_at<window_end),
  'duplicatesPrevented',(SELECT count(*) FROM owner_vault.intakes WHERE status='duplicate_prevented'),
  'reviewRequired',(SELECT count(*) FROM owner_vault.intakes WHERE status='review_required'),
  'overnight',jsonb_build_object('timezone','Europe/Oslo','start',window_start,'end',window_end,'definition','latest completed 18:00–08:00 interval')) INTO result;
 INSERT INTO owner_vault.events(action,actor_id,reason_code) VALUES('read.statistics',sb.user_id(),'audited_read');
 RETURN result;
END $$;

CREATE FUNCTION owner_vault.review_contact(contact_uuid uuid,desired_status text,expected_version integer,reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM owner_vault.require_owner(true);
 IF desired_status IS NULL OR desired_status NOT IN ('unconfirmed','confirmed','review_required') OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Documented review required' USING ERRCODE='22023';
 END IF;
 UPDATE owner_vault.contacts SET verification_status=desired_status,version=version+1,updated_at=clock_timestamp() WHERE id=contact_uuid AND version=expected_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contact missing or changed' USING ERRCODE='22023'; END IF;
 -- The reason is private evidence, not copied into the general staff audit.
 INSERT INTO owner_vault.intakes(actor_id,request_key,payload_hash,payload,status,contact_id,reason_code)
  VALUES(sb.user_id(),gen_random_uuid(),encode(public.digest(reason,'sha256'),'hex'),jsonb_build_object('reviewReason',btrim(reason),'status',desired_status,'version',expected_version+1),'accepted',contact_uuid,'owner_review');
 INSERT INTO owner_vault.events(action,actor_id,resource_id,reason_code) VALUES('contact.reviewed',sb.user_id(),contact_uuid,desired_status);
END $$;

-- Functions are owned by a distinct non-login, non-BYPASSRLS executor, never
-- shadowbridge_policy. No role membership or blanket future object ACLs.
GRANT CREATE ON SCHEMA owner_vault TO shadowbridge_vault_executor;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='owner_vault' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_vault_executor',f.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,shadowbridge_api,shadowbridge_vault_ingest',f.signature);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA owner_vault FROM shadowbridge_vault_executor;
GRANT EXECUTE ON FUNCTION owner_vault.check_access(),owner_vault.record_failure(text),owner_vault.owner_intake(jsonb,uuid),owner_vault.read_records(text,text,text,integer,integer,uuid),owner_vault.statistics(timestamptz),owner_vault.review_contact(uuid,text,integer,text) TO shadowbridge_api;
GRANT EXECUTE ON FUNCTION owner_vault.ingest(jsonb,uuid) TO shadowbridge_vault_ingest;
COMMIT;
