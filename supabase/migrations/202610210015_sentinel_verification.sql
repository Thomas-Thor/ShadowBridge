-- H3-A only: private company verification and immutable evidence/history.
-- No queue, registry requests, analytics, account approval or existing-data backfill.
BEGIN;

DO $$ BEGIN
 -- An existing NOLOGIN role could still own objects or hold confidential ACLs.
 -- The reserved role is created only once by this tracked migration; never
 -- reuse, alter or silently revoke an unknown pre-existing principal.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='shadowbridge_sentinel') THEN
  RAISE EXCEPTION 'Reserved Sentinel role already exists; administrative review required' USING ERRCODE='42501';
 END IF;
 CREATE ROLE shadowbridge_sentinel NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION;
END $$;
-- The future worker has no schema/table/function grants in H3-A. It cannot
-- operate until the separately tested lease-based worker stage is approved.

INSERT INTO sb.staff_permissions(key) VALUES
 ('sentinel.read'),('sentinel.review'),('sentinel.checks.record');
-- No non-OWNER role assignment is expanded. OWNER retains its existing dynamic
-- authority; other verified staff require explicit delegation of these rights.

CREATE TABLE sb.company_verifications (
 company_id uuid PRIMARY KEY REFERENCES sb.companies(id),
 status text NOT NULL DEFAULT 'declared' CHECK(status IN ('declared','in_review','verified','rejected','inactive')),
 verified_check_id uuid,
 verified_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid NOT NULL REFERENCES sb.accounts(user_id),
 CHECK((status='verified' AND verified_check_id IS NOT NULL AND verified_at IS NOT NULL)
   OR (status<>'verified' AND verified_check_id IS NULL AND verified_at IS NULL))
);
CREATE TABLE sb.verification_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES sb.company_verifications(company_id),
 source_application_id uuid REFERENCES sb.applications(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','needs_information','completed','archived')),
 opened_by uuid NOT NULL REFERENCES sb.accounts(user_id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz,
 UNIQUE(id,company_id),
 CHECK((status IN ('completed','archived'))=(closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX sentinel_one_active_case ON sb.verification_cases(company_id)
 WHERE status IN ('open','in_review','needs_information');
CREATE INDEX sentinel_cases_status ON sb.verification_cases(status,updated_at DESC,id);

CREATE TABLE sb.verification_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL,
 company_id uuid NOT NULL,
 check_type text NOT NULL CHECK(check_type IN ('company_identity','representation','format','duplicate')),
 source_kind text NOT NULL CHECK(source_kind IN ('manual','rule','official_registry')),
 outcome text NOT NULL CHECK(outcome IN ('confirmed','not_found','mismatch','invalid_number','unavailable','ambiguous','unsupported','needs_review')),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 6 AND 300),
 evidence_sha256 text CHECK(evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_type text NOT NULL CHECK(actor_type IN ('staff','system')),
 actor_user_id uuid REFERENCES sb.accounts(user_id),
 procedure_version text NOT NULL CHECK(length(procedure_version) BETWEEN 1 AND 80),
 checked_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(case_id,company_id) REFERENCES sb.verification_cases(id,company_id),
 UNIQUE(id,company_id),
 CHECK((actor_type='staff' AND actor_user_id IS NOT NULL) OR (actor_type='system' AND actor_user_id IS NULL)),
 CHECK(source_kind<>'manual' OR actor_type='staff')
);
CREATE INDEX sentinel_checks_history ON sb.verification_checks(case_id,recorded_at DESC,id);
ALTER TABLE sb.company_verifications ADD CONSTRAINT sentinel_company_check
 FOREIGN KEY(verified_check_id,company_id) REFERENCES sb.verification_checks(id,company_id);

CREATE TABLE sb.verification_case_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id uuid NOT NULL,
 company_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('opened','check_recorded','reviewed')),
 actor_type text NOT NULL CHECK(actor_type IN ('staff','system')),
 actor_user_id uuid REFERENCES sb.accounts(user_id),
 from_status text CHECK(from_status IN ('open','in_review','needs_information','completed','archived')),
 to_status text NOT NULL CHECK(to_status IN ('open','in_review','needs_information','completed','archived')),
 company_from_status text CHECK(company_from_status IN ('declared','in_review','verified','rejected','inactive')),
 company_to_status text NOT NULL CHECK(company_to_status IN ('declared','in_review','verified','rejected','inactive')),
 check_id uuid,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 procedure_version text NOT NULL DEFAULT 'sentinel-schema-v1' CHECK(length(procedure_version) BETWEEN 1 AND 80),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(case_id,company_id) REFERENCES sb.verification_cases(id,company_id),
 FOREIGN KEY(check_id,company_id) REFERENCES sb.verification_checks(id,company_id),
 CHECK((actor_type='staff' AND actor_user_id IS NOT NULL) OR (actor_type='system' AND actor_user_id IS NULL))
);
CREATE INDEX sentinel_events_history ON sb.verification_case_events(case_id,recorded_at DESC,id DESC);

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['company_verifications','verification_cases','verification_checks','verification_case_events'] LOOP
  EXECUTE format('ALTER TABLE sb.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE sb.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON sb.%I FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin,shadowbridge_sentinel',tab);
  EXECUTE format('GRANT SELECT ON sb.%I TO shadowbridge_api,shadowbridge_policy',tab);
 END LOOP;
END $$;
GRANT INSERT,UPDATE ON sb.company_verifications,sb.verification_cases TO shadowbridge_policy;
GRANT INSERT ON sb.verification_checks,sb.verification_case_events TO shadowbridge_policy;
GRANT USAGE,SELECT ON SEQUENCE sb.verification_case_events_id_seq TO shadowbridge_policy;
REVOKE ALL ON SEQUENCE sb.verification_case_events_id_seq FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin,shadowbridge_sentinel;

CREATE FUNCTION sb.sentinel_can_read(company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.has_permission('sentinel.read') AND sb.has_permission('counterparties.read')
  AND sb.has_permission('companies.read') AND EXISTS(SELECT 1 FROM sb.companies WHERE id=company)
$$;
ALTER FUNCTION sb.sentinel_can_read(uuid) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.sentinel_can_read(uuid) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin,shadowbridge_sentinel;
GRANT EXECUTE ON FUNCTION sb.sentinel_can_read(uuid) TO shadowbridge_api;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['company_verifications','verification_cases','verification_checks','verification_case_events'] LOOP
  EXECUTE format('CREATE POLICY sentinel_read ON sb.%I FOR SELECT TO shadowbridge_api USING(sb.sentinel_can_read(company_id))',tab);
 END LOOP;
END $$;
CREATE TRIGGER immutable_sentinel_checks BEFORE UPDATE OR DELETE ON sb.verification_checks
 FOR EACH ROW EXECUTE FUNCTION sb.prevent_workspace_history_change();
CREATE TRIGGER immutable_sentinel_events BEFORE UPDATE OR DELETE ON sb.verification_case_events
 FOR EACH ROW EXECUTE FUNCTION sb.prevent_workspace_history_change();

CREATE FUNCTION sb.sentinel_open_case(company uuid,source_application uuid,reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing uuid; current_status text;
BEGIN
 IF NOT sb.sentinel_can_read(company) OR NOT sb.has_permission('sentinel.review') THEN
  RAISE EXCEPTION 'Sentinel review permission and verified staff MFA required' USING ERRCODE='42501';
 END IF;
 IF source_application IS NOT NULL AND NOT sb.has_permission('applications.read') THEN
  RAISE EXCEPTION 'Application review permission is required for a source application' USING ERRCODE='42501';
 END IF;
 IF reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 2000 THEN
  RAISE EXCEPTION 'A documented review reason is required' USING ERRCODE='22023';
 END IF;
 -- All writers acquire the company row before a case, serializing duplicate
 -- opening, evidence capture and review without modifying the company itself.
 PERFORM 1 FROM sb.companies WHERE id=company FOR UPDATE;
 IF NOT sb.sentinel_can_read(company) OR NOT sb.has_permission('sentinel.review')
  OR (source_application IS NOT NULL AND NOT sb.has_permission('applications.read')) THEN
  RAISE EXCEPTION 'Sentinel review authorization changed' USING ERRCODE='42501';
 END IF;
 IF source_application IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM sb.applications a JOIN sb.accounts u ON u.user_id=a.user_id
  WHERE a.id=source_application AND a.company_id=company AND u.email_verified_at IS NOT NULL AND u.status='active'
 ) THEN RAISE EXCEPTION 'Matching email-confirmed source application required' USING ERRCODE='22023'; END IF;
 INSERT INTO sb.company_verifications(company_id,updated_by) VALUES(company,sb.user_id()) ON CONFLICT(company_id) DO NOTHING;
 SELECT id INTO existing FROM sb.verification_cases
  WHERE company_id=company AND status IN ('open','in_review','needs_information');
 IF FOUND THEN RETURN existing; END IF;
 SELECT status INTO current_status FROM sb.company_verifications WHERE company_id=company;
 INSERT INTO sb.verification_cases(company_id,source_application_id,opened_by)
  VALUES(company,source_application,sb.user_id()) RETURNING id INTO existing;
 INSERT INTO sb.verification_case_events(case_id,company_id,kind,actor_type,actor_user_id,to_status,company_to_status,reason)
  VALUES(existing,company,'opened','staff',sb.user_id(),'open',current_status,btrim(reason));
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata)
  VALUES(sb.user_id(),'sentinel.case_opened','sb.verification_cases',existing::text,jsonb_build_object('companyId',company));
 RETURN existing;
END $$;
ALTER FUNCTION sb.sentinel_open_case(uuid,uuid,text) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.sentinel_open_case(uuid,uuid,text) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin,shadowbridge_sentinel;
GRANT EXECUTE ON FUNCTION sb.sentinel_open_case(uuid,uuid,text) TO shadowbridge_api;

CREATE FUNCTION sb.sentinel_record_check(case_uuid uuid,check_type text,outcome text,evidence_ref text,reason text,
 evidence_sha256 text DEFAULT NULL,checked_at timestamptz DEFAULT now()) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item sb.verification_cases; check_uuid uuid; company_status text;
BEGIN
 SELECT * INTO item FROM sb.verification_cases WHERE id=case_uuid;
 IF NOT FOUND OR NOT sb.sentinel_can_read(item.company_id) OR NOT sb.has_permission('sentinel.checks.record') THEN
  RAISE EXCEPTION 'Sentinel evidence permission and verified staff MFA required' USING ERRCODE='42501';
 END IF;
 IF check_type IS NULL OR check_type NOT IN ('company_identity','representation')
  OR outcome IS NULL OR outcome NOT IN ('confirmed','not_found','mismatch','invalid_number','unavailable','ambiguous','unsupported','needs_review')
  OR evidence_ref IS NULL OR length(btrim(evidence_ref)) NOT BETWEEN 6 AND 300
  OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 2000
  OR evidence_sha256 IS NOT NULL AND evidence_sha256 !~ '^[a-f0-9]{64}$'
  OR checked_at IS NULL OR NOT isfinite(checked_at) OR checked_at>clock_timestamp()+interval '1 minute' THEN
  RAISE EXCEPTION 'Invalid manual evidence record' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM sb.companies WHERE id=item.company_id FOR UPDATE;
 IF NOT sb.sentinel_can_read(item.company_id) OR NOT sb.has_permission('sentinel.checks.record') THEN
  RAISE EXCEPTION 'Sentinel evidence authorization changed' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT item FROM sb.verification_cases WHERE id=case_uuid FOR UPDATE;
 IF item.status IN ('completed','archived') THEN
  RAISE EXCEPTION 'The case is closed; open a new review instead' USING ERRCODE='22023';
 END IF;
 INSERT INTO sb.verification_checks(case_id,company_id,check_type,source_kind,outcome,evidence_reference,evidence_sha256,
   reason,actor_type,actor_user_id,procedure_version,checked_at)
  VALUES(case_uuid,item.company_id,check_type,'manual',outcome,btrim(evidence_ref),evidence_sha256,
   btrim(reason),'staff',sb.user_id(),'manual-v1',checked_at) RETURNING id INTO check_uuid;
 UPDATE sb.verification_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=case_uuid;
 SELECT status INTO company_status FROM sb.company_verifications WHERE company_id=item.company_id;
 INSERT INTO sb.verification_case_events(case_id,company_id,kind,actor_type,actor_user_id,from_status,to_status,
   company_from_status,company_to_status,check_id,reason)
  VALUES(case_uuid,item.company_id,'check_recorded','staff',sb.user_id(),item.status,item.status,
   company_status,company_status,check_uuid,btrim(reason));
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata)
  VALUES(sb.user_id(),'sentinel.check_recorded','sb.verification_checks',check_uuid::text,
   jsonb_build_object('caseId',case_uuid,'companyId',item.company_id,'checkType',check_type,'outcome',outcome,'sourceKind','manual'));
 RETURN check_uuid;
END $$;
ALTER FUNCTION sb.sentinel_record_check(uuid,text,text,text,text,text,timestamptz) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.sentinel_record_check(uuid,text,text,text,text,text,timestamptz) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin,shadowbridge_sentinel;
GRANT EXECUTE ON FUNCTION sb.sentinel_record_check(uuid,text,text,text,text,text,timestamptz) TO shadowbridge_api;

CREATE FUNCTION sb.sentinel_review_case(case_uuid uuid,new_case_status text,new_company_status text,reason text,expected_version integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item sb.verification_cases; company_status text; positive_check uuid; positive_outcome text;
BEGIN
 SELECT * INTO item FROM sb.verification_cases WHERE id=case_uuid;
 IF NOT FOUND OR NOT sb.sentinel_can_read(item.company_id) OR NOT sb.has_permission('sentinel.review') THEN
  RAISE EXCEPTION 'Sentinel review permission and verified staff MFA required' USING ERRCODE='42501';
 END IF;
 IF reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 2000 OR expected_version IS NULL OR expected_version<1
  OR new_case_status IS NULL OR new_case_status NOT IN ('in_review','needs_information','completed','archived')
  OR new_company_status IS NULL OR new_company_status NOT IN ('declared','in_review','verified','rejected','inactive') THEN
  RAISE EXCEPTION 'Invalid documented case decision' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM sb.companies WHERE id=item.company_id FOR UPDATE;
 IF NOT sb.sentinel_can_read(item.company_id) OR NOT sb.has_permission('sentinel.review') THEN
  RAISE EXCEPTION 'Sentinel review authorization changed' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT item FROM sb.verification_cases WHERE id=case_uuid FOR UPDATE;
 IF item.status IN ('completed','archived') OR item.version<>expected_version THEN
  RAISE EXCEPTION 'Closed or changed case; reload the current review' USING ERRCODE='22023';
 END IF;
 SELECT status INTO STRICT company_status FROM sb.company_verifications WHERE company_id=item.company_id FOR UPDATE;
 IF (new_case_status='completed' AND new_company_status NOT IN ('verified','rejected','inactive'))
  OR (new_case_status='archived' AND new_company_status<>company_status)
  OR (new_case_status IN ('in_review','needs_information') AND new_company_status NOT IN ('declared','in_review')) THEN
  RAISE EXCEPTION 'Company decision and case stage do not agree' USING ERRCODE='22023';
 END IF;
 IF new_case_status='archived' THEN
  SELECT verified_check_id INTO positive_check FROM sb.company_verifications WHERE company_id=item.company_id;
 ELSIF new_company_status='verified' THEN
  SELECT id,outcome INTO positive_check,positive_outcome FROM sb.verification_checks
   WHERE case_id=case_uuid AND company_id=item.company_id AND check_type='company_identity'
   ORDER BY recorded_at DESC,id DESC LIMIT 1;
  IF positive_check IS NULL OR positive_outcome<>'confirmed' THEN
   RAISE EXCEPTION 'Documented positive company evidence is required' USING ERRCODE='22023';
  END IF;
 END IF;
 IF new_case_status<>'archived' THEN
  UPDATE sb.company_verifications SET status=new_company_status,
    verified_check_id=positive_check,verified_at=CASE WHEN positive_check IS NOT NULL THEN clock_timestamp() ELSE NULL END,
    version=version+1,updated_at=clock_timestamp(),updated_by=sb.user_id()
   WHERE company_id=item.company_id;
 END IF;
 UPDATE sb.verification_cases SET status=new_case_status,version=version+1,updated_at=clock_timestamp(),
   closed_at=CASE WHEN new_case_status IN ('completed','archived') THEN clock_timestamp() ELSE NULL END
  WHERE id=case_uuid;
 INSERT INTO sb.verification_case_events(case_id,company_id,kind,actor_type,actor_user_id,from_status,to_status,
   company_from_status,company_to_status,check_id,reason)
  VALUES(case_uuid,item.company_id,'reviewed','staff',sb.user_id(),item.status,new_case_status,
   company_status,new_company_status,positive_check,btrim(reason));
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata)
  VALUES(sb.user_id(),'sentinel.case_reviewed','sb.verification_cases',case_uuid::text,
   jsonb_build_object('companyId',item.company_id,'caseStatus',new_case_status,'companyStatus',new_company_status));
END $$;
ALTER FUNCTION sb.sentinel_review_case(uuid,text,text,text,integer) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.sentinel_review_case(uuid,text,text,text,integer) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin,shadowbridge_sentinel;
GRANT EXECUTE ON FUNCTION sb.sentinel_review_case(uuid,text,text,text,integer) TO shadowbridge_api;

COMMIT;
