-- Run only through a DBA migration connection after GoTrue has initialized auth.users.
-- Browser/normal API credentials must never receive the migration or policy role.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='shadowbridge_api') THEN CREATE ROLE shadowbridge_api NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='shadowbridge_sessions') THEN CREATE ROLE shadowbridge_sessions NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='shadowbridge_policy') THEN CREATE ROLE shadowbridge_policy NOLOGIN NOSUPERUSER BYPASSRLS; END IF;
END $$;
CREATE SCHEMA sb;
CREATE SCHEMA portal;
REVOKE ALL ON SCHEMA sb, portal FROM PUBLIC;
GRANT USAGE ON SCHEMA sb TO shadowbridge_api, shadowbridge_sessions, shadowbridge_policy;
GRANT USAGE ON SCHEMA portal TO shadowbridge_api, shadowbridge_policy;
GRANT CREATE ON SCHEMA sb TO shadowbridge_policy;

CREATE TABLE sb.accounts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 2 AND 200),
 registration_number text NOT NULL CHECK(length(registration_number) BETWEEN 2 AND 100), country text NOT NULL CHECK(length(country) BETWEEN 2 AND 100),
 created_by uuid NOT NULL REFERENCES sb.accounts(user_id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES sb.accounts(user_id),
 company_id uuid NOT NULL REFERENCES sb.companies(id), requested_role text NOT NULL CHECK(requested_role IN ('buyer','supplier','partner')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), decision_note text,
 reviewed_by uuid REFERENCES sb.accounts(user_id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,company_id,requested_role)
);
CREATE TABLE sb.memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES sb.accounts(user_id), company_id uuid NOT NULL REFERENCES sb.companies(id),
 role text NOT NULL CHECK(role IN ('buyer','supplier','partner')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','suspended')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,company_id,role)
);
CREATE TABLE sb.staff_grants (user_id uuid PRIMARY KEY REFERENCES sb.accounts(user_id), active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sb.offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE DEFAULT ('SB-OF-'||gen_random_uuid()::text),
 company_id uuid NOT NULL REFERENCES sb.companies(id), created_by uuid NOT NULL REFERENCES sb.accounts(user_id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','clarification_requested','approved','rejected')),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=40000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.rfqs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE DEFAULT ('SB-RFQ-'||gen_random_uuid()::text),
 company_id uuid NOT NULL REFERENCES sb.companies(id), created_by uuid NOT NULL REFERENCES sb.accounts(user_id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','clarification_requested','accepted','closed')),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=40000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.partner_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE DEFAULT ('SB-OP-'||gen_random_uuid()::text),
 company_id uuid NOT NULL REFERENCES sb.companies(id), created_by uuid NOT NULL REFERENCES sb.accounts(user_id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','accepted','declined')),
 data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=40000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.professional_profiles (
 user_id uuid PRIMARY KEY REFERENCES sb.accounts(user_id), company_id uuid NOT NULL REFERENCES sb.companies(id),
 countries text[] NOT NULL DEFAULT '{}', sectors text[] NOT NULL DEFAULT '{}', summary text NOT NULL DEFAULT '' CHECK(length(summary)<=4000), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately contains no source-company ID, internal record ID, contact or source document.
CREATE TABLE portal.opportunities (
 public_id text PRIMARY KEY DEFAULT ('SB-ANON-'||gen_random_uuid()::text), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=16000),
 status text NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','withdrawn')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.opportunity_sources (public_id text PRIMARY KEY REFERENCES portal.opportunities(public_id), offer_id uuid NOT NULL REFERENCES sb.offers(id));
CREATE TABLE sb.opportunity_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL REFERENCES portal.opportunities(public_id), company_id uuid NOT NULL REFERENCES sb.companies(id),
 role text NOT NULL CHECK(role IN ('buyer','partner')), active boolean NOT NULL DEFAULT true, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(public_id,company_id,role)
);
CREATE TABLE sb.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE DEFAULT ('SB-MSG-'||gen_random_uuid()::text),
 resource_type text NOT NULL CHECK(resource_type IN ('offer','rfq','opportunity','proposal')), resource_public_id text NOT NULL,
 sender_user_id uuid NOT NULL REFERENCES sb.accounts(user_id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text NOT NULL UNIQUE DEFAULT ('SB-PRJ-'||gen_random_uuid()::text),
 partner_company_id uuid NOT NULL REFERENCES sb.companies(id), title text NOT NULL CHECK(length(title)<=200), status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','active','on_hold','completed','cancelled')),
 summary text NOT NULL DEFAULT '' CHECK(length(summary)<=4000), created_at timestamptz NOT NULL DEFAULT now()
 ,UNIQUE(id,partner_company_id)
);
CREATE TABLE sb.commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES sb.projects(id), partner_company_id uuid NOT NULL REFERENCES sb.companies(id),
 amount numeric(18,2) CHECK(amount>=0), currency text CHECK(currency ~ '^[A-Z]{3}$'), agreement_reference text,
 status text NOT NULL DEFAULT 'under_agreement' CHECK(status IN ('under_agreement','agreed','accrued','paid','cancelled')), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,partner_company_id) REFERENCES sb.projects(id,partner_company_id)
);
CREATE TABLE sb.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES sb.accounts(user_id), action text NOT NULL, resource text NOT NULL,
 resource_id text, created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE sb.sessions (
 id_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 encrypted_tokens text NOT NULL, csrf_token text, recovery_only boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION sb.user_id() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION sb.account_active(require_verified boolean DEFAULT true) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM sb.accounts a WHERE a.user_id=sb.user_id() AND a.status='active' AND (NOT require_verified OR a.email_verified_at IS NOT NULL))
$$;
CREATE FUNCTION sb.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(true) AND current_setting('request.jwt.claim.aal',true)='aal2' AND EXISTS(SELECT 1 FROM sb.staff_grants s WHERE s.user_id=sb.user_id() AND s.active)
$$;
CREATE FUNCTION sb.has_staff_grant() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(true) AND EXISTS(SELECT 1 FROM sb.staff_grants s WHERE s.user_id=sb.user_id() AND s.active)
$$;
CREATE FUNCTION sb.has_role(company uuid, requested_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(true) AND EXISTS(SELECT 1 FROM sb.memberships m WHERE m.user_id=sb.user_id() AND m.company_id=company AND m.role=requested_role AND m.status='approved')
$$;
CREATE FUNCTION sb.owns_company(company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(false) AND EXISTS(SELECT 1 FROM sb.companies c WHERE c.id=company AND c.created_by=sb.user_id())
$$;
CREATE FUNCTION sb.can_view_opportunity(opportunity text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(true) AND EXISTS(SELECT 1 FROM sb.opportunity_grants g JOIN portal.opportunities p ON p.public_id=g.public_id WHERE g.public_id=opportunity AND p.status='approved' AND g.active AND (g.expires_at IS NULL OR g.expires_at>now()) AND sb.has_role(g.company_id,g.role))
$$;
CREATE FUNCTION sb.can_access_resource(kind text, resource text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.is_staff() OR CASE kind
 WHEN 'offer' THEN EXISTS(SELECT 1 FROM sb.offers o WHERE o.public_id=resource AND sb.has_role(o.company_id,'supplier'))
 WHEN 'rfq' THEN EXISTS(SELECT 1 FROM sb.rfqs r WHERE r.public_id=resource AND sb.has_role(r.company_id,'buyer'))
 WHEN 'proposal' THEN EXISTS(SELECT 1 FROM sb.partner_proposals p WHERE p.public_id=resource AND sb.has_role(p.company_id,'partner'))
 WHEN 'opportunity' THEN sb.can_view_opportunity(resource) ELSE false END
$$;

CREATE FUNCTION sb.submit_application(role text, company jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company_uuid uuid; application_uuid uuid;
BEGIN
 IF NOT sb.account_active(false) OR role NOT IN ('buyer','supplier','partner') THEN RAISE EXCEPTION 'Application not permitted' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM sb.applications a WHERE a.user_id=sb.user_id() AND a.status IN ('pending','approved')) THEN RAISE EXCEPTION 'An active application already exists' USING ERRCODE='23505'; END IF;
 INSERT INTO sb.companies(legal_name,registration_number,country,created_by) VALUES(company->>'legal_name',company->>'registration_number',company->>'country',sb.user_id()) RETURNING id INTO company_uuid;
 INSERT INTO sb.applications(user_id,company_id,requested_role) VALUES(sb.user_id(),company_uuid,role) RETURNING id INTO application_uuid;
 INSERT INTO sb.memberships(user_id,company_id,role) VALUES(sb.user_id(),company_uuid,role);
 RETURN application_uuid;
END $$;
CREATE FUNCTION sb.decide_application(application uuid, decision text, note text DEFAULT '') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE record sb.applications;
BEGIN
 IF NOT sb.is_staff() OR decision NOT IN ('approved','rejected') OR length(note)>2000 THEN RAISE EXCEPTION 'Management approval not permitted' USING ERRCODE='42501'; END IF;
 SELECT * INTO record FROM sb.applications WHERE id=application FOR UPDATE;
 IF NOT FOUND OR record.status<>'pending' THEN RAISE EXCEPTION 'Pending application required'; END IF;
 IF decision='approved' AND NOT EXISTS(SELECT 1 FROM sb.accounts a WHERE a.user_id=record.user_id AND a.status='active' AND a.email_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified active applicant required'; END IF;
 UPDATE sb.applications SET status=decision,decision_note=note,reviewed_by=sb.user_id(),reviewed_at=now() WHERE id=application;
 UPDATE sb.memberships SET status=CASE WHEN decision='approved' THEN 'approved' ELSE 'suspended' END WHERE user_id=record.user_id AND company_id=record.company_id AND role=record.requested_role;
END $$;
CREATE FUNCTION sb.set_membership_status(membership uuid, desired_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.is_staff() OR desired_status NOT IN ('approved','suspended') THEN RAISE EXCEPTION 'Management permission required' USING ERRCODE='42501'; END IF;
 IF desired_status='approved' AND NOT EXISTS(SELECT 1 FROM sb.memberships m JOIN sb.applications a ON a.user_id=m.user_id AND a.company_id=m.company_id AND a.requested_role=m.role JOIN sb.accounts u ON u.user_id=m.user_id WHERE m.id=membership AND a.status='approved' AND u.email_verified_at IS NOT NULL AND u.status='active') THEN RAISE EXCEPTION 'Approved application and verified account required'; END IF;
 UPDATE sb.memberships SET status=desired_status WHERE id=membership;
END $$;
CREATE FUNCTION sb.publish_opportunity(source_offer uuid, sanitized_data jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE opportunity text;
BEGIN
 IF NOT sb.is_staff() THEN RAISE EXCEPTION 'Management permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sb.offers WHERE id=source_offer AND status='approved') THEN RAISE EXCEPTION 'Approved source offer required'; END IF;
 -- Strict structural allowlist: never copy an internal offer object, documents or source IDs.
 IF jsonb_typeof(sanitized_data)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(sanitized_data) k WHERE k NOT IN ('title','category','specification','quantity','unit','price','currency','incoterms','availability','validUntil')) THEN RAISE EXCEPTION 'Only approved anonymous opportunity fields are accepted'; END IF;
 IF EXISTS(SELECT FROM jsonb_each(sanitized_data) x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value #>> '{}')>2000) THEN RAISE EXCEPTION 'Anonymous card values must be short reviewed text'; END IF;
 IF sanitized_data::text ~* '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|https?://|www\.)' THEN RAISE EXCEPTION 'Contact information is forbidden in anonymous cards'; END IF;
 IF EXISTS(SELECT 1 FROM sb.offers o JOIN sb.companies c ON c.id=o.company_id WHERE o.id=source_offer AND (strpos(lower(sanitized_data::text),lower(c.legal_name))>0 OR (length(c.registration_number)>3 AND strpos(lower(sanitized_data::text),lower(c.registration_number))>0))) THEN RAISE EXCEPTION 'Source identity is forbidden in anonymous cards'; END IF;
 INSERT INTO portal.opportunities(data) VALUES(sanitized_data) RETURNING public_id INTO opportunity;
 INSERT INTO sb.opportunity_sources(public_id,offer_id) VALUES(opportunity,source_offer);
 RETURN opportunity;
END $$;
CREATE FUNCTION sb.grant_opportunity(opportunity text, company uuid, requested_role text, expiry timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.is_staff() OR requested_role NOT IN ('buyer','partner') THEN RAISE EXCEPTION 'Management permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sb.memberships m JOIN sb.accounts a ON a.user_id=m.user_id WHERE m.company_id=company AND m.role=requested_role AND m.status='approved' AND a.status='active' AND a.email_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Approved recipient company required'; END IF;
 INSERT INTO sb.opportunity_grants(public_id,company_id,role,expires_at) VALUES(opportunity,company,requested_role,expiry) ON CONFLICT(public_id,company_id,role) DO UPDATE SET active=true,expires_at=excluded.expires_at;
END $$;

CREATE FUNCTION sb.sync_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO sb.accounts(user_id,email,email_verified_at) VALUES(new.id,coalesce(new.email,''),new.email_confirmed_at)
 ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,email_verified_at=excluded.email_verified_at;
 RETURN new;
END $$;
CREATE TRIGGER shadowbridge_sync_auth AFTER INSERT OR UPDATE OF email,email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION sb.sync_auth_user();
INSERT INTO sb.accounts(user_id,email,email_verified_at) SELECT id,coalesce(email,''),email_confirmed_at FROM auth.users ON CONFLICT(user_id) DO NOTHING;

CREATE FUNCTION sb.enforce_business_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.id<>old.id OR new.public_id<>old.public_id OR new.company_id<>old.company_id OR new.created_by<>old.created_by OR new.created_at<>old.created_at THEN RAISE EXCEPTION 'Record identity is immutable' USING ERRCODE='42501'; END IF;
 IF NOT sb.is_staff() AND (old.created_by<>sb.user_id() OR old.status NOT IN ('draft','clarification_requested') OR new.status NOT IN ('draft','submitted')) THEN RAISE EXCEPTION 'Only own editable drafts may be submitted' USING ERRCODE='42501'; END IF;
 new.updated_at=now(); RETURN new;
END $$;
CREATE TRIGGER offer_update BEFORE UPDATE ON sb.offers FOR EACH ROW EXECUTE FUNCTION sb.enforce_business_update();
CREATE TRIGGER rfq_update BEFORE UPDATE ON sb.rfqs FOR EACH ROW EXECUTE FUNCTION sb.enforce_business_update();
CREATE TRIGGER proposal_update BEFORE UPDATE ON sb.partner_proposals FOR EACH ROW EXECUTE FUNCTION sb.enforce_business_update();

CREATE FUNCTION sb.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;
BEGIN
 item=CASE WHEN tg_op='DELETE' THEN to_jsonb(old) ELSE to_jsonb(new) END;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(sb.user_id(),lower(tg_op),tg_table_schema||'.'||tg_table_name,coalesce(item->>'id',item->>'public_id',item->>'user_id'),jsonb_strip_nulls(jsonb_build_object('status',item->>'status','role',coalesce(item->>'requested_role',item->>'role'))));
 RETURN CASE WHEN tg_op='DELETE' THEN old ELSE new END;
END $$;
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['accounts','companies','applications','memberships','staff_grants','offers','rfqs','partner_proposals','professional_profiles','opportunity_sources','opportunity_grants','messages','projects','commissions'] LOOP
  EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON sb.%I FOR EACH ROW EXECUTE FUNCTION sb.audit_change()',item);
 END LOOP;
END $$;
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON portal.opportunities FOR EACH ROW EXECUTE FUNCTION sb.audit_change();

DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('sb','portal') LOOP
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',item.schemaname,item.tablename);
  EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',item.schemaname,item.tablename);
 END LOOP;
END $$;

CREATE POLICY account_select ON sb.accounts FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() OR sb.is_staff());
CREATE POLICY account_staff_update ON sb.accounts FOR UPDATE TO shadowbridge_api USING(sb.is_staff()) WITH CHECK(sb.is_staff());
CREATE POLICY company_select ON sb.companies FOR SELECT TO shadowbridge_api USING(sb.owns_company(id) OR sb.is_staff());
CREATE POLICY application_select ON sb.applications FOR SELECT TO shadowbridge_api USING((user_id=sb.user_id() AND sb.account_active(false)) OR sb.is_staff());
CREATE POLICY membership_select ON sb.memberships FOR SELECT TO shadowbridge_api USING((user_id=sb.user_id() AND sb.account_active(false)) OR sb.is_staff());
CREATE POLICY staff_select ON sb.staff_grants FOR SELECT TO shadowbridge_api USING(sb.is_staff());
CREATE POLICY profile_select ON sb.professional_profiles FOR SELECT TO shadowbridge_api USING((user_id=sb.user_id() AND sb.account_active(false)) OR sb.is_staff());
CREATE POLICY profile_insert ON sb.professional_profiles FOR INSERT TO shadowbridge_api WITH CHECK(user_id=sb.user_id() AND sb.owns_company(company_id));
CREATE POLICY profile_update ON sb.professional_profiles FOR UPDATE TO shadowbridge_api USING(user_id=sb.user_id() AND sb.owns_company(company_id)) WITH CHECK(user_id=sb.user_id() AND sb.owns_company(company_id));

DO $$ DECLARE tbl text; role_name text; BEGIN
 FOR tbl,role_name IN VALUES('offers','supplier'),('rfqs','buyer'),('partner_proposals','partner') LOOP
  EXECUTE format('CREATE POLICY business_select ON sb.%I FOR SELECT TO shadowbridge_api USING(sb.has_role(company_id,%L) OR sb.is_staff())',tbl,role_name);
  EXECUTE format('CREATE POLICY business_insert ON sb.%I FOR INSERT TO shadowbridge_api WITH CHECK((created_by=sb.user_id() AND sb.has_role(company_id,%L) AND status IN (''draft'',''submitted'')) OR sb.is_staff())',tbl,role_name);
  EXECUTE format('CREATE POLICY business_update ON sb.%I FOR UPDATE TO shadowbridge_api USING((created_by=sb.user_id() AND sb.has_role(company_id,%L) AND status IN (''draft'',''clarification_requested'')) OR sb.is_staff()) WITH CHECK((created_by=sb.user_id() AND sb.has_role(company_id,%L) AND status IN (''draft'',''submitted'')) OR sb.is_staff())',tbl,role_name,role_name);
 END LOOP;
END $$;
CREATE POLICY opportunity_select ON portal.opportunities FOR SELECT TO shadowbridge_api USING(sb.is_staff() OR sb.can_view_opportunity(public_id));
CREATE POLICY opportunity_staff_update ON portal.opportunities FOR UPDATE TO shadowbridge_api USING(sb.is_staff()) WITH CHECK(sb.is_staff());
CREATE POLICY source_staff ON sb.opportunity_sources FOR SELECT TO shadowbridge_api USING(sb.is_staff());
CREATE POLICY grant_select ON sb.opportunity_grants FOR SELECT TO shadowbridge_api USING(sb.is_staff() OR (active AND (expires_at IS NULL OR expires_at>now()) AND sb.has_role(company_id,role)));
CREATE POLICY grant_staff_update ON sb.opportunity_grants FOR UPDATE TO shadowbridge_api USING(sb.is_staff()) WITH CHECK(sb.is_staff());
CREATE POLICY message_select ON sb.messages FOR SELECT TO shadowbridge_api USING(sb.can_access_resource(resource_type,resource_public_id));
CREATE POLICY message_insert ON sb.messages FOR INSERT TO shadowbridge_api WITH CHECK(sender_user_id=sb.user_id() AND sb.can_access_resource(resource_type,resource_public_id));
CREATE POLICY project_select ON sb.projects FOR SELECT TO shadowbridge_api USING(sb.is_staff() OR sb.has_role(partner_company_id,'partner'));
CREATE POLICY project_staff_write ON sb.projects FOR ALL TO shadowbridge_api USING(sb.is_staff()) WITH CHECK(sb.is_staff());
CREATE POLICY commission_select ON sb.commissions FOR SELECT TO shadowbridge_api USING(sb.is_staff() OR sb.has_role(partner_company_id,'partner'));
CREATE POLICY commission_staff_write ON sb.commissions FOR ALL TO shadowbridge_api USING(sb.is_staff()) WITH CHECK(sb.is_staff());
CREATE POLICY audit_staff_select ON sb.audit_events FOR SELECT TO shadowbridge_api USING(sb.is_staff());
CREATE POLICY session_service ON sb.sessions FOR ALL TO shadowbridge_sessions USING(true) WITH CHECK(true);

-- No API role can INSERT/UPDATE membership, application decisions, staff grants or audit rows directly.
GRANT SELECT ON ALL TABLES IN SCHEMA sb TO shadowbridge_api;
REVOKE ALL ON sb.sessions FROM shadowbridge_api;
GRANT SELECT,UPDATE ON portal.opportunities TO shadowbridge_api;
GRANT INSERT ON sb.offers,sb.rfqs,sb.partner_proposals,sb.professional_profiles,sb.messages,sb.projects,sb.commissions TO shadowbridge_api;
GRANT UPDATE(data,status) ON sb.offers,sb.rfqs,sb.partner_proposals TO shadowbridge_api;
GRANT UPDATE(status) ON sb.accounts TO shadowbridge_api;
GRANT UPDATE(countries,sectors,summary) ON sb.professional_profiles TO shadowbridge_api;
GRANT UPDATE(title,status,summary) ON sb.projects TO shadowbridge_api;
GRANT UPDATE(amount,currency,agreement_reference,status) ON sb.commissions TO shadowbridge_api;
GRANT UPDATE(active,expires_at) ON sb.opportunity_grants TO shadowbridge_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON sb.sessions TO shadowbridge_sessions;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sb,portal TO shadowbridge_policy;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sb TO shadowbridge_policy;

-- Definer functions use a NOLOGIN role; never grant this role to the API/session/Auth logins.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sb' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',item.signature);
  IF item.proname<>'user_id' THEN EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_policy',item.signature); END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION sb.user_id(),sb.account_active(boolean),sb.is_staff(),sb.has_staff_grant(),sb.has_role(uuid,text),sb.owns_company(uuid),sb.can_view_opportunity(text),sb.can_access_resource(text,text),sb.submit_application(text,jsonb),sb.decide_application(uuid,text,text),sb.set_membership_status(uuid,text),sb.publish_opportunity(uuid,jsonb),sb.grant_opportunity(text,uuid,text,timestamptz) TO shadowbridge_api;
GRANT EXECUTE ON FUNCTION sb.user_id() TO shadowbridge_policy;
REVOKE CREATE ON SCHEMA sb FROM shadowbridge_policy;
CREATE INDEX offers_company ON sb.offers(company_id);
CREATE INDEX rfqs_company ON sb.rfqs(company_id);
CREATE INDEX proposals_company ON sb.partner_proposals(company_id);
CREATE INDEX grants_recipient ON sb.opportunity_grants(company_id,role) WHERE active;
CREATE INDEX messages_resource ON sb.messages(resource_type,resource_public_id,created_at);
CREATE INDEX sessions_expiry ON sb.sessions(expires_at);
COMMIT;
