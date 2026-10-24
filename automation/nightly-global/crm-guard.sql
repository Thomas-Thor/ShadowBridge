-- CANDIDATE, NOT an automatic migration. Separate OWNER deployment approval.
-- Uses the existing OWNER VAULT. No OWNER sessions, role changes, or raw reads
-- granted to agents. No login/password is created. Paid operations default OFF.
BEGIN;
DO $$ BEGIN
 IF to_regnamespace('owner_vault') IS NULL OR to_regnamespace('acquisition_guard') IS NOT NULL THEN RAISE EXCEPTION 'Existing Vault required; guard must be new';END IF;
END $$;
CREATE SCHEMA acquisition_guard;
REVOKE ALL ON SCHEMA acquisition_guard FROM PUBLIC;
GRANT USAGE ON SCHEMA acquisition_guard TO shadowbridge_vault_executor,shadowbridge_vault_ingest;
CREATE TABLE acquisition_guard.settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false,paid_enabled boolean NOT NULL DEFAULT false);
INSERT INTO acquisition_guard.settings DEFAULT VALUES;
CREATE TABLE acquisition_guard.aliases(kind text NOT NULL CHECK(kind IN ('company','contact')),provider text NOT NULL,external_id text NOT NULL,company_id uuid NOT NULL REFERENCES owner_vault.companies(id),contact_id uuid REFERENCES owner_vault.contacts(id),PRIMARY KEY(kind,provider,external_id));
CREATE TABLE acquisition_guard.policies(provider text NOT NULL,operation text NOT NULL CHECK(operation IN ('email_reveal','enrichment')),approved boolean NOT NULL DEFAULT false,unit_credit_max numeric CHECK(unit_credit_max>=0),daily_cap numeric NOT NULL DEFAULT 0 CHECK(daily_cap>=0),monthly_cap numeric NOT NULL DEFAULT 0 CHECK(monthly_cap>=0),available_credits numeric CHECK(available_credits>=0),verified_at timestamptz,PRIMARY KEY(provider,operation));
CREATE TABLE acquisition_guard.reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agent_id uuid NOT NULL,request_key uuid NOT NULL,payload_hash text NOT NULL,payload jsonb NOT NULL,company_source_id text NOT NULL,fields text[] NOT NULL,provider text NOT NULL,operation text NOT NULL,target text NOT NULL,credits numeric NOT NULL,status text NOT NULL CHECK(status IN ('reserved','dispatched','completed','uncertain','cancelled')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),receipt uuid,UNIQUE(agent_id,request_key));
CREATE TABLE acquisition_guard.field_locks(target text NOT NULL,field text NOT NULL,reservation_id uuid NOT NULL REFERENCES acquisition_guard.reservations(id),PRIMARY KEY(target,field));
CREATE TABLE acquisition_guard.searches(provider text NOT NULL,fingerprint text NOT NULL,filters jsonb NOT NULL,cursor jsonb NOT NULL DEFAULT '{"page":1}',exhausted boolean NOT NULL DEFAULT false,lease uuid,lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(provider,fingerprint));
CREATE TABLE acquisition_guard.events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,agent_id uuid,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['settings','aliases','policies','reservations','field_locks','searches','events'] LOOP
  EXECUTE format('ALTER TABLE acquisition_guard.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE acquisition_guard.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY executor_only ON acquisition_guard.%I TO shadowbridge_vault_executor USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA acquisition_guard TO shadowbridge_vault_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA acquisition_guard TO shadowbridge_vault_executor;

CREATE FUNCTION acquisition_guard.agent() RETURNS owner_vault.agents LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a owner_vault.agents;BEGIN
 IF NOT pg_has_role(session_user,'shadowbridge_vault_ingest','member') OR NOT EXISTS(SELECT FROM acquisition_guard.settings WHERE enabled) THEN RAISE EXCEPTION 'Acquisition disabled' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM owner_vault.agents WHERE database_role=session_user AND active AND source_system IN ('apollo','clay','relevance');
 IF NOT FOUND THEN RAISE EXCEPTION 'Active bound agent required' USING ERRCODE='42501';END IF;RETURN a;
END $$;
CREATE FUNCTION acquisition_guard.norm(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT lower(regexp_replace(btrim(coalesce(v,'')),'[[:space:]]+',' ','g')) $$;
CREATE FUNCTION acquisition_guard.domain(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT regexp_replace(lower(substring(coalesce(v,'') FROM '^https://([^/:]+)')),'^www\.','') $$;
CREATE FUNCTION acquisition_guard.match(p jsonb,company_source text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();b jsonb:=p->'company';c jsonb:=p->'contact';co uuid;person uuid;ids uuid[];present jsonb;v owner_vault.contacts;
BEGIN
 IF p IS NULL OR octet_length(p::text)>16000 OR p#>>'{source,system}' IS DISTINCT FROM a.source_system OR coalesce(length(company_source),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid bound source' USING ERRCODE='22023';END IF;
 IF c IS NOT NULL THEN PERFORM owner_vault.validate_intake(p);
 ELSE PERFORM owner_vault.validate_intake(p||'{"contact":{"fullName":"validation only"}}'::jsonb);END IF;
 SELECT coalesce(array_agg(DISTINCT id),'{}') INTO ids FROM (
  SELECT id FROM owner_vault.companies WHERE country=b->>'country' AND registration_number<>'' AND registration_number=upper(btrim(b->>'registrationNumber'))
  UNION SELECT company_id FROM acquisition_guard.aliases WHERE kind='company' AND provider=a.source_system AND external_id=company_source
 )q;
 IF cardinality(ids)>1 THEN RETURN '{"review":true}'::jsonb;END IF;co=ids[1];
 IF co IS NULL AND coalesce(b->>'registrationNumber','')='' AND EXISTS(SELECT FROM owner_vault.companies WHERE country=b->>'country' AND (acquisition_guard.norm(name)=acquisition_guard.norm(b->>'name') OR (coalesce(acquisition_guard.domain(b->>'website'),'')<>'' AND acquisition_guard.domain(website)=acquisition_guard.domain(b->>'website')))) THEN RETURN '{"review":true}'::jsonb;END IF;
 IF co IS NOT NULL AND EXISTS(SELECT FROM owner_vault.companies WHERE id=co AND (country<>b->>'country' OR (registration_number<>'' AND coalesce(b->>'registrationNumber','')<>'' AND registration_number<>upper(btrim(b->>'registrationNumber'))))) THEN RETURN '{"review":true}'::jsonb;END IF;
 IF c IS NOT NULL THEN
  SELECT coalesce(array_agg(DISTINCT id),'{}') INTO ids FROM (
   SELECT contact_id AS id FROM owner_vault.identity_keys WHERE (kind='source' AND key=a.source_system||':'||(p#>>'{source,recordId}')) OR (kind='professional' AND key<>'' AND key=rtrim(c->>'professionalUrl','/'))
   UNION SELECT contact_id FROM acquisition_guard.aliases WHERE kind='contact' AND provider=a.source_system AND external_id=p#>>'{source,recordId}'
   UNION SELECT id FROM owner_vault.contacts WHERE co IS NOT NULL AND company_id=co AND owner_vault.individual_email(c) AND email_kind='individual' AND lower(work_email)=lower(c->>'workEmail')
  )q;
  IF cardinality(ids)>1 THEN RETURN '{"review":true}'::jsonb;END IF;person=ids[1];
  IF person IS NOT NULL THEN
   SELECT * INTO v FROM owner_vault.contacts WHERE id=person;
   IF co IS NULL OR v.company_id<>co OR acquisition_guard.norm(v.full_name)<>acquisition_guard.norm(c->>'fullName') OR (v.work_email<>'' AND coalesce(c->>'workEmail','')<>'' AND lower(v.work_email)<>lower(c->>'workEmail')) THEN RETURN '{"review":true}'::jsonb;END IF;
  ELSIF co IS NOT NULL AND EXISTS(SELECT FROM owner_vault.contacts WHERE company_id=co AND acquisition_guard.norm(full_name)=acquisition_guard.norm(c->>'fullName')) THEN RETURN '{"review":true}'::jsonb;
  END IF;
 END IF;
 SELECT jsonb_build_object('website',coalesce(website,'')<>'','sector',coalesce(sector,'')<>'') INTO present FROM owner_vault.companies WHERE id=co;
 present=coalesce(present,'{"website":false,"sector":false}'::jsonb)||jsonb_build_object('workEmail',coalesce(v.work_email,'')<>'','title',coalesce(v.title,'')<>'','professionalUrl',coalesce(v.professional_url,'')<>'');
 IF co IS NOT NULL THEN
  present=present||jsonb_build_object(
   'website',(present->>'website')::boolean OR EXISTS(SELECT FROM owner_vault.intakes WHERE payload->>'acquisitionCompanyId'=co::text AND reason_code LIKE 'acquisition_%' AND coalesce(payload#>>'{company,website}','')<>''),
   'sector',(present->>'sector')::boolean OR EXISTS(SELECT FROM owner_vault.intakes WHERE payload->>'acquisitionCompanyId'=co::text AND reason_code LIKE 'acquisition_%' AND coalesce(payload#>>'{company,sector}','')<>''));
 END IF;
 -- Newly acquired facts may await an OWNER-controlled merge. They already
 -- belong to the central CRM history and must never be purchased a second time.
 IF person IS NOT NULL THEN
  present=present||jsonb_build_object(
   'workEmail',(present->>'workEmail')::boolean OR EXISTS(SELECT FROM owner_vault.intakes WHERE contact_id=person AND reason_code='acquisition_review_required' AND coalesce(payload#>>'{contact,workEmail}','')<>''),
   'title',(present->>'title')::boolean OR EXISTS(SELECT FROM owner_vault.intakes WHERE contact_id=person AND reason_code='acquisition_review_required' AND coalesce(payload#>>'{contact,title}','')<>''),
   'professionalUrl',(present->>'professionalUrl')::boolean OR EXISTS(SELECT FROM owner_vault.intakes WHERE contact_id=person AND reason_code='acquisition_review_required' AND coalesce(payload#>>'{contact,professionalUrl}','')<>''));
 END IF;
 RETURN jsonb_build_object('review',false,'companyId',co,'contactId',person,'present',present);
END $$;
CREATE FUNCTION acquisition_guard.check_record(p jsonb,company_source text,needed text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb;f text;missing text[]:='{}';a owner_vault.agents:=acquisition_guard.agent();BEGIN
 IF needed IS NULL OR cardinality(needed) NOT BETWEEN 1 AND 5 OR NOT needed<@ARRAY['workEmail','title','professionalUrl','website','sector']::text[] THEN RAISE EXCEPTION 'Explicit supported fields required' USING ERRCODE='22023';END IF;
 m=acquisition_guard.match(p,company_source);
 INSERT INTO acquisition_guard.events(agent_id,action) VALUES(a.id,CASE WHEN (m->>'review')::boolean THEN 'check.review' ELSE 'check.completed' END);
 IF (m->>'review')::boolean THEN RETURN '{"decision":"review_required","paidAllowed":false}'::jsonb;END IF;
 FOREACH f IN ARRAY needed LOOP IF NOT coalesce((m#>>ARRAY['present',f])::boolean,false) THEN missing=array_append(missing,f);END IF;END LOOP;
 RETURN jsonb_build_object('decision',CASE WHEN cardinality(missing)=0 THEN 'already_complete' ELSE 'missing_fields' END,'missing',missing,'paidAllowed',false);
END $$;
CREATE FUNCTION acquisition_guard.save_record(p jsonb,company_source text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();m jsonb;co uuid;person uuid;receipt uuid;outcome text;old owner_vault.intakes;h text;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('shadowbridge-owner-vault-intake'));
 m=acquisition_guard.match(p,company_source);h=encode(public.digest((p||jsonb_build_object('companySourceId',company_source))::text,'sha256'),'hex');
 IF request_id IS NULL THEN RAISE EXCEPTION 'Request key required' USING ERRCODE='22023';END IF;
 SELECT * INTO old FROM owner_vault.intakes WHERE agent_id=a.id AND request_key=request_id;
 IF FOUND THEN IF old.payload_hash<>h THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('receipt',old.id,'status',old.status);END IF;
 IF (SELECT count(*) FROM owner_vault.intakes WHERE agent_id=a.id AND created_at>now()-interval '5 minutes')>=60 THEN RAISE EXCEPTION 'Intake limit' USING ERRCODE='54000';END IF;
 IF (m->>'review')::boolean THEN outcome='review_required';
 ELSE
  co=(m->>'companyId')::uuid;person=(m->>'contactId')::uuid;
  IF co IS NULL THEN INSERT INTO owner_vault.companies(name,country,registration_number,sector,website) VALUES(btrim(p#>>'{company,name}'),p#>>'{company,country}',upper(btrim(coalesce(p#>>'{company,registrationNumber}',''))),coalesce(p#>>'{company,sector}',''),coalesce(p#>>'{company,website}','')) RETURNING id INTO co;END IF;
  INSERT INTO acquisition_guard.aliases VALUES('company',a.source_system,company_source,co,NULL) ON CONFLICT DO NOTHING;
  outcome='duplicate_prevented';
  IF p ? 'contact' THEN
   IF person IS NULL THEN
    -- Existing central Vault tables and identity keys, under the same intake
    -- lock as its OWNER writer. Never create a competing contacts database.
    INSERT INTO owner_vault.contacts(company_id,full_name,title,work_email,email_kind,professional_url,source_system,source_record_id,source_url,agent_id)
     VALUES(co,btrim(p#>>'{contact,fullName}'),coalesce(p#>>'{contact,title}',''),lower(coalesce(p#>>'{contact,workEmail}','')),coalesce(p#>>'{contact,emailKind}','unknown'),rtrim(coalesce(p#>>'{contact,professionalUrl}',''),'/'),a.source_system,p#>>'{source,recordId}',coalesce(p#>>'{source,url}',''),a.id) RETURNING id INTO person;
    INSERT INTO owner_vault.identity_keys VALUES('source',a.source_system||':'||(p#>>'{source,recordId}'),person);
    IF coalesce(p#>>'{contact,professionalUrl}','')<>'' THEN INSERT INTO owner_vault.identity_keys VALUES('professional',rtrim(p#>>'{contact,professionalUrl}','/'),person);END IF;
    IF owner_vault.individual_email(p->'contact') THEN INSERT INTO owner_vault.identity_keys VALUES('email_company',lower(p#>>'{contact,workEmail}')||':'||co::text,person);END IF;
    outcome='accepted';
   ELSIF EXISTS(SELECT FROM owner_vault.contacts WHERE id=person AND ((work_email='' AND coalesce(p#>>'{contact,workEmail}','')<>'') OR (title='' AND coalesce(p#>>'{contact,title}','')<>'') OR (professional_url='' AND coalesce(p#>>'{contact,professionalUrl}','')<>''))) THEN
    -- Preserve new facts as a CRM review intake; never overwrite OWNER edits.
    outcome='review_required';
   END IF;
   IF person IS NOT NULL THEN INSERT INTO acquisition_guard.aliases VALUES('contact',a.source_system,p#>>'{source,recordId}',co,person) ON CONFLICT DO NOTHING;END IF;
  ELSIF m->>'companyId' IS NULL THEN outcome='accepted';END IF;
 END IF;
 INSERT INTO owner_vault.intakes(agent_id,request_key,payload_hash,payload,status,contact_id,reason_code) VALUES(a.id,request_id,h,p||jsonb_build_object('acquisitionCompanyId',co,'acquisitionNewCompany',NOT (m->>'review')::boolean AND m->>'companyId' IS NULL),outcome,person,'acquisition_'||outcome) RETURNING id INTO receipt;
 INSERT INTO owner_vault.events(action,agent_id,resource_id,reason_code) VALUES('acquisition.'||outcome,a.id,coalesce(person,co,receipt),'source_history');
 RETURN jsonb_build_object('receipt',receipt,'status',outcome);
END $$;
CREATE FUNCTION acquisition_guard.usage() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();d date:=(clock_timestamp() AT TIME ZONE 'Europe/Oslo')::date;report jsonb;BEGIN
 SELECT jsonb_build_object('provider',a.source_system,'day',d,'timezone','Europe/Oslo',
  'newCompanies',count(*) FILTER(WHERE payload->>'acquisitionNewCompany'='true'),
  'newContacts',count(*) FILTER(WHERE status='accepted' AND contact_id IS NOT NULL),
  'duplicates',count(*) FILTER(WHERE status='duplicate_prevented'),
  'reviewRequired',count(*) FILTER(WHERE status='review_required')) INTO report FROM owner_vault.intakes WHERE agent_id=a.id AND (created_at AT TIME ZONE 'Europe/Oslo')::date=d;
 RETURN report||jsonb_build_object(
  'creditUpperBoundReserved',(SELECT coalesce(sum(credits),0) FROM acquisition_guard.reservations WHERE provider=a.source_system AND (created_at AT TIME ZONE 'Europe/Oslo')::date=d),
  'uncertainPurchases',(SELECT count(*) FROM acquisition_guard.reservations WHERE provider=a.source_system AND status IN ('dispatched','uncertain')),
  'actualCredits',NULL,'actualMoneyCost',NULL,'billingReconciled',false);
END $$;
CREATE FUNCTION acquisition_guard.reserve(p jsonb,company_source text,needed text[],request_id uuid,op text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();m jsonb;decision jsonb;pol acquisition_guard.policies;old acquisition_guard.reservations;target_key text;rid uuid;f text;daily numeric;monthly numeric;since_balance numeric;h text;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('shadowbridge-owner-vault-intake'));
 PERFORM pg_advisory_xact_lock(hashtext('shadowbridge-acquisition-payment'));
 decision=acquisition_guard.check_record(p,company_source,needed);
 IF decision->>'decision'<>'missing_fields' THEN RETURN decision||'{"allowed":false}'::jsonb;END IF;
 IF cardinality(needed)<>jsonb_array_length(decision->'missing') OR (op='email_reveal' AND (needed<>ARRAY['workEmail']::text[] OR NOT p ? 'contact')) THEN RETURN '{"allowed":false,"decision":"exclude_owned_fields_or_wrong_operation"}'::jsonb;END IF;
 m=acquisition_guard.match(p,company_source);
 -- Unknown company identity cannot justify a purchase. Exact-name candidates
 -- were already stopped for human review, even if there is just one candidate.
 IF m->>'companyId' IS NULL THEN RETURN '{"allowed":false,"decision":"company_identity_required"}'::jsonb;END IF;
 IF NOT EXISTS(SELECT FROM acquisition_guard.settings WHERE paid_enabled) THEN RETURN '{"allowed":false,"decision":"paid_disabled"}'::jsonb;END IF;
 SELECT * INTO pol FROM acquisition_guard.policies WHERE provider=a.source_system AND operation=op FOR UPDATE;
 IF NOT FOUND OR NOT pol.approved OR pol.unit_credit_max IS NULL OR pol.available_credits IS NULL OR pol.verified_at IS NULL OR pol.verified_at<clock_timestamp()-interval '24 hours' THEN RETURN '{"allowed":false,"decision":"unverified_budget_or_contract"}'::jsonb;END IF;
 h=encode(public.digest((p||jsonb_build_object('needed',needed,'operation',op,'companySourceId',company_source))::text,'sha256'),'hex');
 SELECT * INTO old FROM acquisition_guard.reservations WHERE agent_id=a.id AND request_key=request_id;
 IF FOUND THEN IF old.payload_hash<>h THEN RAISE EXCEPTION 'Changed reservation retry' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('allowed',false,'decision','already_reserved_no_redispatch','reservation',old.id);END IF;
 target_key=(m->>'companyId')||':person:'||acquisition_guard.norm(p#>>'{contact,fullName}');
 IF EXISTS(SELECT FROM acquisition_guard.field_locks WHERE field=ANY(needed) AND target=(CASE WHEN field IN ('website','sector') THEN (m->>'companyId')||':company' ELSE target_key END)) THEN RETURN '{"allowed":false,"decision":"field_already_reserved"}'::jsonb;END IF;
 -- Shared across email reveal/enrichment policies for this provider account.
 SELECT coalesce(sum(credits) FILTER(WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=(clock_timestamp() AT TIME ZONE 'Europe/Oslo')::date),0),coalesce(sum(credits),0),coalesce(sum(credits) FILTER(WHERE created_at>=pol.verified_at),0) INTO daily,monthly,since_balance FROM acquisition_guard.reservations WHERE provider=a.source_system AND date_trunc('month',created_at AT TIME ZONE 'Europe/Oslo')=date_trunc('month',clock_timestamp() AT TIME ZONE 'Europe/Oslo');
 SELECT coalesce(sum(credits),0) INTO since_balance FROM acquisition_guard.reservations WHERE provider=a.source_system AND created_at>=pol.verified_at;
 IF daily+pol.unit_credit_max>least(pol.daily_cap,(SELECT min(daily_cap) FROM acquisition_guard.policies WHERE provider=a.source_system AND approved)) OR monthly+pol.unit_credit_max>least(pol.monthly_cap,(SELECT min(monthly_cap) FROM acquisition_guard.policies WHERE provider=a.source_system AND approved)) OR since_balance+pol.unit_credit_max>pol.available_credits THEN RETURN '{"allowed":false,"decision":"budget_stop"}'::jsonb;END IF;
 INSERT INTO acquisition_guard.reservations(agent_id,request_key,payload_hash,payload,company_source_id,fields,provider,operation,target,credits,status) VALUES(a.id,request_id,h,p,company_source,needed,a.source_system,op,target_key,pol.unit_credit_max,'reserved') RETURNING id INTO rid;
 FOREACH f IN ARRAY needed LOOP INSERT INTO acquisition_guard.field_locks VALUES(CASE WHEN f IN ('website','sector') THEN (m->>'companyId')||':company' ELSE target_key END,f,rid);END LOOP;
 INSERT INTO acquisition_guard.events(agent_id,action) VALUES(a.id,'payment.reserved');
 RETURN jsonb_build_object('allowed',true,'reservation',rid);
END $$;
CREATE FUNCTION acquisition_guard.dispatch(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();r acquisition_guard.reservations;d jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('shadowbridge-owner-vault-intake'));
 SELECT * INTO r FROM acquisition_guard.reservations WHERE id=rid AND agent_id=a.id FOR UPDATE;
 IF NOT FOUND OR r.status<>'reserved' OR NOT EXISTS(SELECT FROM acquisition_guard.settings WHERE paid_enabled) THEN RETURN '{"dispatch":false,"decision":"no_redispatch"}'::jsonb;END IF;
 IF NOT EXISTS(SELECT FROM acquisition_guard.policies WHERE provider=r.provider AND operation=r.operation AND approved AND verified_at>clock_timestamp()-interval '24 hours') THEN RETURN '{"dispatch":false,"decision":"policy_revoked_or_stale"}'::jsonb;END IF;
 d=acquisition_guard.check_record(r.payload,r.company_source_id,r.fields);
 IF d->>'decision'<>'missing_fields' THEN UPDATE acquisition_guard.reservations SET status='cancelled' WHERE id=rid;RETURN d||'{"dispatch":false}'::jsonb;END IF;
 UPDATE acquisition_guard.reservations SET status='dispatched' WHERE id=rid;
 INSERT INTO acquisition_guard.events(agent_id,action) VALUES(a.id,'payment.dispatched_once');
 RETURN jsonb_build_object('dispatch',true,'reservation',rid);
END $$;
CREATE FUNCTION acquisition_guard.finish(rid uuid,p jsonb,company_source text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();r acquisition_guard.reservations;saved jsonb;BEGIN
 SELECT * INTO r FROM acquisition_guard.reservations WHERE id=rid AND agent_id=a.id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('dispatched','completed') THEN RAISE EXCEPTION 'No dispatched reservation' USING ERRCODE='42501';END IF;
 IF r.status='completed' THEN RETURN jsonb_build_object('receipt',r.receipt,'replay',true);END IF;
 IF company_source IS DISTINCT FROM r.company_source_id OR p#>>'{source,recordId}' IS DISTINCT FROM r.payload#>>'{source,recordId}' OR acquisition_guard.norm(p#>>'{contact,fullName}')<>acquisition_guard.norm(r.payload#>>'{contact,fullName}') OR p->'company' IS DISTINCT FROM r.payload->'company' THEN RAISE EXCEPTION 'Changed enrichment target' USING ERRCODE='22023';END IF;
 saved=acquisition_guard.save_record(p,company_source,request_id);
 UPDATE acquisition_guard.reservations SET status='completed',receipt=(saved->>'receipt')::uuid WHERE id=rid;
 RETURN saved;
END $$;
CREATE FUNCTION acquisition_guard.uncertain(rid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();BEGIN
 UPDATE acquisition_guard.reservations SET status='uncertain' WHERE id=rid AND agent_id=a.id AND status='dispatched';
 INSERT INTO acquisition_guard.events(agent_id,action) VALUES(a.id,'payment.uncertain_no_retry');
END $$;
CREATE FUNCTION acquisition_guard.search_page(filters jsonb,done_cursor jsonb DEFAULT NULL,lease_id uuid DEFAULT NULL,is_exhausted boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_vault.agents:=acquisition_guard.agent();fp text;s acquisition_guard.searches;token uuid;BEGIN
 IF filters IS NULL OR jsonb_typeof(filters)<>'object' OR octet_length(filters::text)>8192 OR filters->>'country' IS NULL OR filters->>'sector' IS NULL OR filters->>'sourceKey' IS NULL OR octet_length(coalesce(done_cursor,'{}')::text)>4096 THEN RAISE EXCEPTION 'Bounded explicit search partition required';END IF;
 fp=encode(public.digest(filters::text,'sha256'),'hex');
 INSERT INTO acquisition_guard.searches(provider,fingerprint,filters) VALUES(a.source_system,fp,filters) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM acquisition_guard.searches WHERE provider=a.source_system AND fingerprint=fp FOR UPDATE;
 IF done_cursor IS NOT NULL THEN
  IF s.lease IS DISTINCT FROM lease_id OR s.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Stale search lease' USING ERRCODE='42501';END IF;
  UPDATE acquisition_guard.searches SET cursor=done_cursor,exhausted=is_exhausted,lease=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE provider=a.source_system AND fingerprint=fp;RETURN '{"checkpointed":true}'::jsonb;
 END IF;
 IF s.exhausted OR s.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('fetch',false,'exhausted',s.exhausted);END IF;
 token=gen_random_uuid();UPDATE acquisition_guard.searches SET lease=token,lease_until=clock_timestamp()+interval '120 seconds' WHERE provider=a.source_system AND fingerprint=fp;
 RETURN jsonb_build_object('fetch',true,'lease',token,'cursor',s.cursor);
END $$;
GRANT CREATE ON SCHEMA acquisition_guard TO shadowbridge_vault_executor;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='acquisition_guard' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_vault_executor',f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,shadowbridge_vault_ingest',f);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA acquisition_guard FROM shadowbridge_vault_executor;
GRANT EXECUTE ON FUNCTION acquisition_guard.check_record(jsonb,text,text[]),acquisition_guard.save_record(jsonb,text,uuid),acquisition_guard.reserve(jsonb,text,text[],uuid,text),acquisition_guard.dispatch(uuid),acquisition_guard.uncertain(uuid),acquisition_guard.finish(uuid,jsonb,text,uuid),acquisition_guard.search_page(jsonb,jsonb,uuid,boolean),acquisition_guard.usage() TO shadowbridge_vault_ingest;
COMMIT;
