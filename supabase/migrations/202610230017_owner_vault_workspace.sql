-- OWNER VAULT V2: additive workspace, reviewed changes and conflict decisions.
-- No platform account changes, integrations, imports, deletes or retention jobs.
BEGIN;
-- Keep every existing row byte-for-byte compatible with preservation guards.
-- Company version 1 is implicit; metadata is created only on an OWNER edit.
CREATE TABLE owner_vault.company_versions(
 company_id uuid PRIMARY KEY REFERENCES owner_vault.companies(id),
 version integer NOT NULL CHECK(version>=2), updated_at timestamptz NOT NULL
);
CREATE TABLE owner_vault.changes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_type text NOT NULL CHECK(resource_type IN ('contact','company')),
 resource_id uuid NOT NULL, actor_id uuid NOT NULL, before_data jsonb NOT NULL, after_data jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX vault_change_resource ON owner_vault.changes(resource_id,created_at DESC,id DESC);
CREATE TABLE owner_vault.resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intake_id uuid NOT NULL UNIQUE REFERENCES owner_vault.intakes(id),
 decision text NOT NULL CHECK(decision IN ('dismiss','link_existing')), contact_id uuid REFERENCES owner_vault.contacts(id),
 actor_id uuid NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((decision='link_existing')=(contact_id IS NOT NULL))
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['changes','resolutions'] LOOP
  EXECUTE format('ALTER TABLE owner_vault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE owner_vault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_read ON owner_vault.%I FOR SELECT TO shadowbridge_vault_executor USING(sb.is_owner())',t);
  EXECUTE format('CREATE POLICY owner_insert ON owner_vault.%I FOR INSERT TO shadowbridge_vault_executor WITH CHECK(sb.is_owner())',t);
  EXECUTE format('CREATE TRIGGER vault_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_vault.%I FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history()',t);
 END LOOP;
END $$;
ALTER TABLE owner_vault.company_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_vault.company_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_metadata_read ON owner_vault.company_versions FOR SELECT TO shadowbridge_vault_executor USING(sb.is_owner());
CREATE POLICY owner_metadata_insert ON owner_vault.company_versions FOR INSERT TO shadowbridge_vault_executor WITH CHECK(sb.is_owner());
CREATE POLICY owner_metadata_update ON owner_vault.company_versions FOR UPDATE TO shadowbridge_vault_executor USING(sb.is_owner()) WITH CHECK(sb.is_owner());
REVOKE ALL ON owner_vault.company_versions FROM PUBLIC,shadowbridge_api,shadowbridge_vault_ingest,shadowbridge_policy,shadowbridge_sentinel,shadowbridge_sessions;
GRANT SELECT,INSERT,UPDATE ON owner_vault.company_versions TO shadowbridge_vault_executor;
REVOKE ALL ON owner_vault.changes,owner_vault.resolutions FROM PUBLIC,shadowbridge_api,shadowbridge_vault_ingest,shadowbridge_policy,shadowbridge_sentinel,shadowbridge_sessions;
GRANT SELECT,INSERT ON owner_vault.changes,owner_vault.resolutions TO shadowbridge_vault_executor;
CREATE POLICY vault_company_owner_update ON owner_vault.companies FOR UPDATE TO shadowbridge_vault_executor USING(sb.is_owner()) WITH CHECK(sb.is_owner());
GRANT UPDATE(name,sector,website,verification_status) ON owner_vault.companies TO shadowbridge_vault_executor;
GRANT UPDATE(full_name,title,work_email,email_kind,professional_url) ON owner_vault.contacts TO shadowbridge_vault_executor;

CREATE FUNCTION owner_vault.overnight_window(at_time timestamptz) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH d AS(SELECT (at_time AT TIME ZONE 'Europe/Oslo')::date - CASE WHEN (at_time AT TIME ZONE 'Europe/Oslo')::time<time '08:00' THEN 1 ELSE 0 END AS day)
 SELECT jsonb_build_object('start',((day-1)+time '18:00') AT TIME ZONE 'Europe/Oslo','end',(day+time '08:00') AT TIME ZONE 'Europe/Oslo','timezone','Europe/Oslo') FROM d
$$;
CREATE FUNCTION owner_vault.workspace_statistics(at_time timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; w jsonb; companies_night bigint;
BEGIN
 PERFORM owner_vault.require_owner();
 s=owner_vault.statistics(at_time); w=owner_vault.overnight_window(at_time);
 SELECT count(*) INTO companies_night FROM owner_vault.companies WHERE created_at>=(w->>'start')::timestamptz AND created_at<(w->>'end')::timestamptz;
 RETURN s||jsonb_build_object('newCompaniesOvernight',companies_night,'newRecordsOvernight',companies_night+(s->>'newContactsOvernight')::bigint,
 'duplicatesPrevented',(s->>'duplicatesPrevented')::bigint+(SELECT count(*) FROM owner_vault.resolutions WHERE decision='link_existing'),
 'reviewRequired',(SELECT count(*) FROM owner_vault.intakes i WHERE status='review_required' AND NOT EXISTS(SELECT FROM owner_vault.resolutions r WHERE r.intake_id=i.id)),
 'contactReviews',(SELECT count(*) FROM owner_vault.contacts WHERE verification_status='review_required'),
 'companyReviews',(SELECT count(*) FROM owner_vault.companies WHERE verification_status='review_required'));
END $$;

CREATE FUNCTION owner_vault.read_workspace(section text,query_text text DEFAULT '',record_status text DEFAULT '',page_number integer DEFAULT 1,page_size integer DEFAULT 25,record_id uuid DEFAULT NULL,company_uuid uuid DEFAULT NULL,period text DEFAULT '',country_code text DEFAULT '',review_queue text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source_sql text; conditions text; searchable text; status_column text; total bigint; items jsonb; w jsonb;
BEGIN
 PERFORM owner_vault.require_owner();
 IF section IS NULL OR section NOT IN ('contacts','companies','intakes','history') OR query_text IS NULL OR length(query_text)>100
 OR record_status IS NULL OR record_status NOT IN ('','unconfirmed','confirmed','review_required','accepted','duplicate_prevented','dismissed')
 OR page_number IS NULL OR page_number NOT BETWEEN 1 AND 10000 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 50
 OR period IS NULL OR period NOT IN ('','overnight') OR country_code IS NULL OR (country_code<>'' AND country_code !~ '^[A-Z]{2}$')
 OR review_queue IS NULL OR review_queue NOT IN ('','open','resolved')
 OR (company_uuid IS NOT NULL AND section<>'contacts') OR (period<>'' AND section NOT IN ('contacts','companies'))
 OR (review_queue<>'' AND section<>'intakes') OR (section='history' AND (country_code<>'' OR record_status<>'' OR query_text<>'')) THEN
 RAISE EXCEPTION 'Invalid Vault workspace filter' USING ERRCODE='22023'; END IF;
 IF section='contacts' THEN
  source_sql='SELECT c.*,b.name AS company_name,b.country,b.registration_number FROM owner_vault.contacts c JOIN owner_vault.companies b ON b.id=c.company_id';
  searchable='v.full_name||'' ''||v.work_email||'' ''||v.company_name||'' ''||v.registration_number||'' ''||v.source_system'; status_column='v.verification_status';
 ELSIF section='companies' THEN
  source_sql='SELECT b.*,coalesce(m.version,1) AS version,m.updated_at,(SELECT count(*) FROM owner_vault.contacts c WHERE c.company_id=b.id) AS contact_count,ARRAY(SELECT DISTINCT c.source_system FROM owner_vault.contacts c WHERE c.company_id=b.id ORDER BY c.source_system LIMIT 5) AS sources FROM owner_vault.companies b LEFT JOIN owner_vault.company_versions m ON m.company_id=b.id';
  searchable='v.name||'' ''||v.registration_number||'' ''||v.sector'; status_column='v.verification_status';
 ELSIF section='intakes' THEN
  source_sql=$q$SELECT i.*,CASE WHEN r.decision='link_existing' THEN 'duplicate_prevented' WHEN r.decision='dismiss' THEN 'dismissed' ELSE i.status END AS effective_status,
   CASE WHEN r.id IS NULL THEN 1 ELSE 2 END AS review_version,
   CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END AS resolution,
   i.payload#>>'{company,country}' AS country FROM owner_vault.intakes i LEFT JOIN owner_vault.resolutions r ON r.intake_id=i.id$q$;
  searchable='v.payload::text'; status_column='v.effective_status';
 ELSE source_sql='SELECT * FROM owner_vault.changes'; searchable='''''';status_column=''''''; END IF;
 conditions='($1='''' OR strpos(lower('||searchable||'),lower($1))>0) AND ($2='''' OR '||status_column||'=$2) AND ($3::uuid IS NULL OR v.'||CASE WHEN section='history' THEN 'resource_id' ELSE 'id' END||'=$3)';
 IF section='contacts' THEN conditions=conditions||' AND ($4::uuid IS NULL OR v.company_id=$4)'; END IF;
 IF section IN ('contacts','companies') THEN
  conditions=conditions||' AND ($5='''' OR (v.created_at >= $8::timestamptz AND v.created_at < $9::timestamptz))';
 END IF;
 IF section<>'history' THEN conditions=conditions||' AND ($6='''' OR v.country=$6)'; END IF;
 IF section='intakes' THEN conditions=conditions||' AND ($7='''' OR ($7=''open'' AND v.effective_status=''review_required'') OR ($7=''resolved'' AND v.resolution IS NOT NULL))'; END IF;
 w=owner_vault.overnight_window(now());
 EXECUTE 'SELECT count(*) FROM ('||source_sql||') v WHERE '||conditions INTO total USING query_text,record_status,record_id,company_uuid,period,country_code,review_queue,w->>'start',w->>'end';
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) FROM (SELECT v.* FROM ('||source_sql||') v WHERE '||conditions||' ORDER BY v.created_at DESC,v.id DESC LIMIT $10 OFFSET $11) x'
 INTO items USING query_text,record_status,record_id,company_uuid,period,country_code,review_queue,w->>'start',w->>'end',page_size,(page_number-1)*page_size;
 INSERT INTO owner_vault.events(action,actor_id,resource_id,reason_code) VALUES('workspace.read.'||section,sb.user_id(),coalesce(record_id,company_uuid),'audited_read');
 RETURN jsonb_build_object('items',items,'total',total,'page',page_number,'limit',page_size,'overnight',CASE WHEN period='overnight' THEN w ELSE NULL END);
END $$;

CREATE FUNCTION owner_vault.edit_record(section text,target uuid,p jsonb,expected_version integer,reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_contact owner_vault.contacts; old_company owner_vault.companies; before_json jsonb; after_json jsonb; b jsonb; c jsonb; k text; profile_key text; email_key text; company_version integer; company_updated timestamptz;
BEGIN
 PERFORM owner_vault.require_owner(true);
 IF section IS NULL OR section NOT IN ('contact','company') OR expected_version IS NULL OR expected_version<1 OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 500
 OR p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'Documented versioned edit required' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('shadowbridge-owner-vault-intake'));
 IF section='company' THEN
  IF NOT p ?& ARRAY['name','sector','website','verificationStatus'] THEN RAISE EXCEPTION 'Missing company fields' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP IF k NOT IN ('name','sector','website','verificationStatus') OR jsonb_typeof(p->k)<>'string' THEN RAISE EXCEPTION 'Invalid company field' USING ERRCODE='22023'; END IF; END LOOP;
  IF length(btrim(p->>'name')) NOT BETWEEN 2 AND 200 OR length(p->>'sector')>200 OR length(p->>'website')>500
   OR (p->>'website'<>'' AND ((p->>'website') !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' OR p->>'website' ~ '[<>"\\?#]'))
   OR p->>'verificationStatus' NOT IN ('unconfirmed','confirmed','review_required') THEN RAISE EXCEPTION 'Invalid company values' USING ERRCODE='22023'; END IF;
  SELECT * INTO old_company FROM owner_vault.companies WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record changed; reload before editing' USING ERRCODE='40001'; END IF;
  SELECT m.version,m.updated_at INTO company_version,company_updated FROM owner_vault.company_versions m WHERE company_id=target;
  company_version=coalesce(company_version,1);
  IF company_version<>expected_version THEN RAISE EXCEPTION 'Record changed; reload before editing' USING ERRCODE='40001'; END IF;
  before_json=to_jsonb(old_company)||jsonb_build_object('version',company_version,'updated_at',company_updated);
  company_updated=clock_timestamp();
  UPDATE owner_vault.companies SET name=btrim(p->>'name'),sector=p->>'sector',website=p->>'website',verification_status=p->>'verificationStatus' WHERE id=target RETURNING to_jsonb(owner_vault.companies.*) INTO after_json;
  INSERT INTO owner_vault.company_versions(company_id,version,updated_at) VALUES(target,company_version+1,company_updated)
   ON CONFLICT(company_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at;
  after_json=after_json||jsonb_build_object('version',company_version+1,'updated_at',company_updated);
 ELSE
  IF NOT p ?& ARRAY['fullName','title','workEmail','emailKind','professionalUrl'] THEN RAISE EXCEPTION 'Missing contact fields' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP IF k NOT IN ('fullName','title','workEmail','emailKind','professionalUrl') OR jsonb_typeof(p->k)<>'string' THEN RAISE EXCEPTION 'Invalid contact field' USING ERRCODE='22023'; END IF; END LOOP;
  SELECT * INTO old_contact FROM owner_vault.contacts WHERE id=target FOR UPDATE;
  IF NOT FOUND OR old_contact.version<>expected_version THEN RAISE EXCEPTION 'Record changed; reload before editing' USING ERRCODE='40001'; END IF;
  SELECT jsonb_build_object('name',name,'country',country,'registrationNumber',registration_number,'sector',sector,'website',website) INTO b FROM owner_vault.companies WHERE id=old_contact.company_id;
  PERFORM owner_vault.validate_intake(jsonb_build_object('company',b,'contact',p,'source',jsonb_build_object('system',old_contact.source_system,'recordId',old_contact.source_record_id,'url',old_contact.source_url)));
  profile_key=rtrim(p->>'professionalUrl','/');
  IF owner_vault.individual_email(p) THEN email_key=lower(p->>'workEmail')||':'||old_contact.company_id::text; END IF;
  IF EXISTS(SELECT FROM owner_vault.identity_keys WHERE contact_id<>target AND ((kind='professional' AND profile_key<>'' AND key=profile_key) OR (kind='email_company' AND key=email_key))) THEN
   RAISE EXCEPTION 'Identity conflict; records were not merged' USING ERRCODE='40001'; END IF;
  before_json=to_jsonb(old_contact);
  UPDATE owner_vault.contacts SET full_name=btrim(p->>'fullName'),title=p->>'title',work_email=lower(p->>'workEmail'),email_kind=p->>'emailKind',professional_url=profile_key,version=version+1,updated_at=clock_timestamp() WHERE id=target RETURNING to_jsonb(owner_vault.contacts.*) INTO after_json;
  -- Old keys remain historical aliases; an edit never steals another identity.
  IF profile_key<>'' THEN INSERT INTO owner_vault.identity_keys VALUES('professional',profile_key,target) ON CONFLICT DO NOTHING; END IF;
  IF email_key IS NOT NULL THEN INSERT INTO owner_vault.identity_keys VALUES('email_company',email_key,target) ON CONFLICT DO NOTHING; END IF;
 END IF;
 INSERT INTO owner_vault.changes(resource_type,resource_id,actor_id,before_data,after_data,reason) VALUES(section,target,sb.user_id(),before_json,after_json,btrim(reason));
 INSERT INTO owner_vault.events(action,actor_id,resource_id,reason_code) VALUES(section||'.edited',sb.user_id(),target,'documented_owner_edit');
END $$;

CREATE FUNCTION owner_vault.resolve_intake(target uuid,decision text,contact_uuid uuid,expected_version integer,reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i owner_vault.intakes; c owner_vault.contacts; b owner_vault.companies; source_key text; profile_key text; email_key text;
BEGIN
 PERFORM owner_vault.require_owner(true);
 IF decision IS NULL OR decision NOT IN ('dismiss','link_existing') OR expected_version IS DISTINCT FROM 1 OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 500
 OR (decision='link_existing')<>(contact_uuid IS NOT NULL) THEN RAISE EXCEPTION 'Documented decision required' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('shadowbridge-owner-vault-intake'));
 SELECT * INTO i FROM owner_vault.intakes WHERE id=target;
 IF NOT FOUND OR i.status<>'review_required' OR EXISTS(SELECT FROM owner_vault.resolutions WHERE intake_id=target) THEN RAISE EXCEPTION 'Intake missing, resolved or changed' USING ERRCODE='40001'; END IF;
 IF decision='link_existing' THEN
  IF NOT coalesce(contact_uuid=ANY(i.candidates),false) THEN RAISE EXCEPTION 'Choose a recorded candidate' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT c FROM owner_vault.contacts WHERE id=contact_uuid;
  SELECT * INTO STRICT b FROM owner_vault.companies WHERE id=c.company_id;
  IF b.registration_number='' OR b.country IS DISTINCT FROM i.payload#>>'{company,country}' OR b.registration_number IS DISTINCT FROM upper(btrim(coalesce(i.payload#>>'{company,registrationNumber}',''))) THEN
   RAISE EXCEPTION 'Company identity conflict requires separate investigation' USING ERRCODE='40001'; END IF;
  source_key=(i.payload#>>'{source,system}')||':'||(i.payload#>>'{source,recordId}');profile_key=rtrim(coalesce(i.payload#>>'{contact,professionalUrl}',''),'/');
  IF owner_vault.individual_email(i.payload->'contact') THEN email_key=lower(i.payload#>>'{contact,workEmail}')||':'||c.company_id::text; END IF;
  IF EXISTS(SELECT FROM owner_vault.identity_keys WHERE contact_id<>contact_uuid AND ((kind='source' AND key=source_key) OR (kind='professional' AND profile_key<>'' AND key=profile_key) OR (kind='email_company' AND key=email_key))) THEN
   RAISE EXCEPTION 'Strong keys still conflict; no identity was reassigned' USING ERRCODE='40001'; END IF;
  INSERT INTO owner_vault.identity_keys VALUES('source',source_key,contact_uuid) ON CONFLICT DO NOTHING;
  IF profile_key<>'' THEN INSERT INTO owner_vault.identity_keys VALUES('professional',profile_key,contact_uuid) ON CONFLICT DO NOTHING; END IF;
  IF email_key IS NOT NULL THEN INSERT INTO owner_vault.identity_keys VALUES('email_company',email_key,contact_uuid) ON CONFLICT DO NOTHING; END IF;
 END IF;
 INSERT INTO owner_vault.resolutions(intake_id,decision,contact_id,actor_id,reason) VALUES(target,decision,contact_uuid,sb.user_id(),btrim(reason));
 INSERT INTO owner_vault.events(action,actor_id,resource_id,reason_code) VALUES('intake.resolved',sb.user_id(),target,decision);
END $$;

-- Preserve V1 endpoint semantics; add a private before/after audit for V2 decisions.
CREATE OR REPLACE FUNCTION owner_vault.review_contact(contact_uuid uuid,desired_status text,expected_version integer,reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous owner_vault.contacts; updated owner_vault.contacts;
BEGIN
 PERFORM owner_vault.require_owner(true);
 IF desired_status IS NULL OR desired_status NOT IN ('unconfirmed','confirmed','review_required') OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Documented review required' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM owner_vault.contacts WHERE id=contact_uuid FOR UPDATE;
 IF NOT FOUND OR previous.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Contact missing or changed' USING ERRCODE='22023'; END IF;
 UPDATE owner_vault.contacts SET verification_status=desired_status,version=version+1,updated_at=clock_timestamp() WHERE id=contact_uuid RETURNING * INTO updated;
 INSERT INTO owner_vault.intakes(actor_id,request_key,payload_hash,payload,status,contact_id,reason_code)
 VALUES(sb.user_id(),gen_random_uuid(),encode(public.digest(reason,'sha256'),'hex'),jsonb_build_object('reviewReason',btrim(reason),'status',desired_status,'version',expected_version+1),'accepted',contact_uuid,'owner_review');
 INSERT INTO owner_vault.changes(resource_type,resource_id,actor_id,before_data,after_data,reason) VALUES('contact',contact_uuid,sb.user_id(),to_jsonb(previous),to_jsonb(updated),btrim(reason));
 INSERT INTO owner_vault.events(action,actor_id,resource_id,reason_code) VALUES('contact.reviewed',sb.user_id(),contact_uuid,desired_status);
END $$;

GRANT CREATE ON SCHEMA owner_vault TO shadowbridge_vault_executor;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='owner_vault' AND p.proname IN ('overnight_window','workspace_statistics','read_workspace','edit_record','resolve_intake') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_vault_executor',f.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,shadowbridge_api,shadowbridge_vault_ingest',f.signature);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA owner_vault FROM shadowbridge_vault_executor;
GRANT EXECUTE ON FUNCTION owner_vault.workspace_statistics(timestamptz),owner_vault.read_workspace(text,text,text,integer,integer,uuid,uuid,text,text,text),owner_vault.edit_record(text,uuid,jsonb,integer,text),owner_vault.resolve_intake(uuid,text,uuid,integer,text) TO shadowbridge_api;
COMMIT;
