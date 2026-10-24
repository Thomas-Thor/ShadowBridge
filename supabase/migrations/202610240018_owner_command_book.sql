-- OWNER operational memory. Additive only: no account, MFA, CRM or agent edits.
BEGIN;
DO $$ BEGIN
 IF to_regnamespace('owner_book') IS NOT NULL OR EXISTS(SELECT FROM pg_roles WHERE rolname='shadowbridge_book_executor') THEN RAISE EXCEPTION 'Reserved Command Book namespace/role already exists';END IF;
 CREATE ROLE shadowbridge_book_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
END $$;
CREATE SCHEMA owner_book;
REVOKE ALL ON SCHEMA owner_book FROM PUBLIC;
GRANT USAGE ON SCHEMA owner_book TO shadowbridge_book_executor,shadowbridge_api,shadowbridge_sessions;
GRANT USAGE ON SCHEMA sb TO shadowbridge_book_executor;
GRANT EXECUTE ON FUNCTION sb.user_id(),sb.is_owner(),sb.require_fresh_owner_mfa() TO shadowbridge_book_executor;

CREATE TABLE owner_book.entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),
 kind text NOT NULL CHECK(kind IN ('task','note','idea','event','decision')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),body text NOT NULL DEFAULT '' CHECK(length(body)<=5000),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('planned','open','in_progress','blocked','done','cancelled','recorded')),
 due_at timestamptz,starts_at timestamptz,ends_at timestamptz,remind_at timestamptz,
 archived boolean NOT NULL DEFAULT false,source_label text NOT NULL,source_ref text NOT NULL DEFAULT '' CHECK(length(source_ref)<=500),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR starts_at IS NOT NULL AND ends_at>=starts_at),CHECK(kind<>'event' OR starts_at IS NOT NULL)
);
CREATE INDEX book_entry_page ON owner_book.entries(owner_id,kind,archived,updated_at DESC,id);
CREATE INDEX book_entry_search ON owner_book.entries USING gin(to_tsvector('simple',title||' '||body));
CREATE TABLE owner_book.dependencies(task_id uuid NOT NULL REFERENCES owner_book.entries(id),depends_on uuid NOT NULL REFERENCES owner_book.entries(id),PRIMARY KEY(task_id,depends_on),CHECK(task_id<>depends_on));
CREATE TABLE owner_book.history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id uuid NOT NULL,entry_id uuid NOT NULL REFERENCES owner_book.entries(id),kind text NOT NULL,channel text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX book_history_page ON owner_book.history(owner_id,entry_id,id DESC);
CREATE TABLE owner_book.api_keys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),name text NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
 token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),mode text NOT NULL CHECK(mode IN ('read_only','custom','book_admin')),
 scopes text[] NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz,revoked_at timestamptz
);
CREATE TABLE owner_book.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id uuid,key_id uuid,action text NOT NULL,outcome text NOT NULL,resource_kind text,request_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX book_audit_page ON owner_book.audit(owner_id,created_at DESC);
CREATE TABLE owner_book.rate_slots(bucket timestamptz NOT NULL,principal text NOT NULL,n integer NOT NULL,writes integer NOT NULL DEFAULT 0,PRIMARY KEY(bucket,principal));
CREATE TABLE owner_book.commands(key_id uuid NOT NULL REFERENCES owner_book.api_keys(id),command_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(key_id,command_id));
CREATE TABLE owner_book.browser_commands(owner_id uuid NOT NULL,command_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner_id,command_id));
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['entries','dependencies','history','api_keys','audit','rate_slots','commands','browser_commands'] LOOP
  EXECUTE format('ALTER TABLE owner_book.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE owner_book.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY internal_executor ON owner_book.%I TO shadowbridge_book_executor USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA owner_book FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA owner_book TO shadowbridge_book_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA owner_book TO shadowbridge_book_executor;
CREATE TRIGGER book_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_book.history FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history();
CREATE TRIGGER book_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_book.audit FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history();

-- Explicit role eligibility for a delegated capability. This does NOT forge an
-- OWNER identity/AAL or expose password/MFA secrets to a machine integration.
GRANT USAGE ON SCHEMA auth TO shadowbridge_policy;
GRANT SELECT(id,email_confirmed_at) ON auth.users TO shadowbridge_policy;
GRANT SELECT(user_id,factor_type,status) ON auth.mfa_factors TO shadowbridge_policy;
CREATE FUNCTION sb.book_owner_active(subject uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM sb.accounts a JOIN sb.staff_grants g USING(user_id) JOIN sb.staff_role_assignments r USING(user_id)
  WHERE a.user_id=subject AND a.status='active' AND a.email_verified_at IS NOT NULL AND g.active AND r.role_key='owner' AND r.active AND (r.expires_at IS NULL OR r.expires_at>now())
  AND EXISTS(SELECT FROM auth.users u WHERE u.id=subject AND u.email_confirmed_at IS NOT NULL)
  AND EXISTS(SELECT FROM auth.mfa_factors f WHERE f.user_id=subject AND f.factor_type='totp' AND f.status='verified'))
$$;
CREATE FUNCTION sb.book_previous_login(subject uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT created_at FROM sb.audit_events WHERE actor_id=subject AND action='auth.login' AND sb.book_owner_active(subject) ORDER BY created_at DESC,id DESC OFFSET 1 LIMIT 1
$$;
CREATE FUNCTION sb.book_platform_events(subject uuid,begin_at timestamptz,end_at timestamptz) RETURNS TABLE(at timestamptz,action text,source text,source_ref text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT created_at,CASE WHEN a.action~'^[a-z0-9_.-]+$' THEN a.action ELSE 'platform.event' END,'sb.audit_events'::text,'sb.audit_events:'||id FROM sb.audit_events a
 WHERE created_at>=begin_at AND created_at<end_at AND sb.book_owner_active(subject)
$$;
GRANT CREATE ON SCHEMA sb TO shadowbridge_policy;
ALTER FUNCTION sb.book_owner_active(uuid) OWNER TO shadowbridge_policy;
ALTER FUNCTION sb.book_previous_login(uuid) OWNER TO shadowbridge_policy;
ALTER FUNCTION sb.book_platform_events(uuid,timestamptz,timestamptz) OWNER TO shadowbridge_policy;
REVOKE CREATE ON SCHEMA sb FROM shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.book_owner_active(uuid),sb.book_previous_login(uuid),sb.book_platform_events(uuid,timestamptz,timestamptz) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION sb.book_owner_active(uuid),sb.book_previous_login(uuid),sb.book_platform_events(uuid,timestamptz,timestamptz) TO shadowbridge_book_executor;
-- Aggregate-only source columns. No contact names, emails, CRM mappings,
-- passwords, tokens, MFA secret or unrestricted CRM read grants are added.
GRANT USAGE ON SCHEMA owner_vault TO shadowbridge_book_executor;
GRANT SELECT(created_at) ON owner_vault.contacts,owner_vault.companies TO shadowbridge_book_executor;
GRANT SELECT(id,action,created_at) ON owner_vault.events TO shadowbridge_book_executor;
CREATE POLICY book_counts ON owner_vault.contacts FOR SELECT TO shadowbridge_book_executor USING(true);
CREATE POLICY book_counts ON owner_vault.companies FOR SELECT TO shadowbridge_book_executor USING(true);
CREATE POLICY book_events ON owner_vault.events FOR SELECT TO shadowbridge_book_executor USING(true);

CREATE FUNCTION owner_book.scopes() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT ARRAY['task.read','task.write','note.read','note.write','idea.read','idea.write','event.read','event.write','decision.read','decision.write','journal.read','summary.export','records.import']::text[] $$;
CREATE FUNCTION owner_book.dto(e owner_book.entries) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (to_jsonb(e)-'owner_id')||jsonb_build_object('dependencies',(SELECT coalesce(jsonb_agg(depends_on ORDER BY depends_on),'[]') FROM owner_book.dependencies WHERE task_id=e.id))
$$;
CREATE FUNCTION owner_book.validate_record(p jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text;v text;BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>20000 THEN RAISE EXCEPTION 'Invalid book record' USING ERRCODE='22023';END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP IF k NOT IN ('id','version','kind','title','body','priority','status','due_at','starts_at','ends_at','remind_at','archived','dependencies','source_ref') THEN RAISE EXCEPTION 'Unknown book field' USING ERRCODE='22023';END IF;END LOOP;
 IF coalesce(p->>'kind','') NOT IN ('task','note','idea','event','decision') OR coalesce(length(btrim(p->>'title')),0) NOT BETWEEN 1 AND 200 OR length(coalesce(p->>'body',''))>5000
  OR coalesce(p->>'priority','normal') NOT IN ('low','normal','high','critical') OR coalesce(p->>'status','open') NOT IN ('planned','open','in_progress','blocked','done','cancelled','recorded') OR length(coalesce(p->>'source_ref',''))>500 THEN RAISE EXCEPTION 'Invalid book values' USING ERRCODE='22023';END IF;
 IF (coalesce(p->>'body','')||' '||coalesce(p->>'title','')||' '||coalesce(p->>'source_ref',''))~*'-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{30,}|sbob_[A-Za-z0-9_-]{43}' THEN RAISE EXCEPTION 'Use a separate password manager for secrets' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['due_at','starts_at','ends_at','remind_at'] LOOP
  v=p->>k;IF v IS NOT NULL AND v<>'' AND v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'Timestamp offset required' USING ERRCODE='22023';END IF;
 END LOOP;
 IF p ? 'dependencies' AND (jsonb_typeof(p->'dependencies')<>'array' OR jsonb_array_length(p->'dependencies')>20) THEN RAISE EXCEPTION 'Invalid dependencies' USING ERRCODE='22023';END IF;
END $$;
CREATE FUNCTION owner_book.save_entry(subject uuid,p jsonb,channel text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old owner_book.entries;old_snapshot jsonb;e owner_book.entries;rid uuid;dep uuid;deps uuid[];BEGIN
 PERFORM owner_book.validate_record(p);PERFORM pg_advisory_xact_lock(hashtext('owner-book:'||subject::text));
 rid=nullif(p->>'id','')::uuid;
 IF rid IS NOT NULL THEN
  SELECT * INTO old FROM owner_book.entries WHERE id=rid AND owner_id=subject FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='P0002';END IF;
  IF old.kind<>p->>'kind' OR old.version IS DISTINCT FROM (p->>'version')::integer THEN RAISE EXCEPTION 'Book conflict' USING ERRCODE='40001';END IF;
  old_snapshot=owner_book.dto(old);
 END IF;
 SELECT coalesce(array_agg(DISTINCT v::uuid),'{}') INTO deps FROM jsonb_array_elements_text(coalesce(p->'dependencies','[]'))v;
 IF p->>'kind'<>'task' AND cardinality(deps)>0 THEN RAISE EXCEPTION 'Only tasks have dependencies' USING ERRCODE='22023';END IF;
 FOREACH dep IN ARRAY deps LOOP
  IF dep=rid OR NOT EXISTS(SELECT FROM owner_book.entries WHERE id=dep AND owner_id=subject AND kind='task' AND NOT archived) THEN RAISE EXCEPTION 'Invalid task dependency' USING ERRCODE='22023';END IF;
  IF rid IS NOT NULL AND EXISTS(WITH RECURSIVE chain(id) AS(SELECT dep UNION SELECT d.depends_on FROM owner_book.dependencies d JOIN chain c ON d.task_id=c.id) SELECT FROM chain WHERE id=rid) THEN RAISE EXCEPTION 'Dependency cycle' USING ERRCODE='22023';END IF;
 END LOOP;
 IF p->>'status'='done' AND EXISTS(SELECT FROM owner_book.entries WHERE id=ANY(deps) AND status<>'done') THEN RAISE EXCEPTION 'Incomplete dependency' USING ERRCODE='22023';END IF;
 IF rid IS NULL THEN
  INSERT INTO owner_book.entries(owner_id,kind,title,body,priority,status,due_at,starts_at,ends_at,remind_at,archived,source_label,source_ref)
  VALUES(subject,p->>'kind',btrim(p->>'title'),coalesce(p->>'body',''),coalesce(p->>'priority','normal'),coalesce(p->>'status',CASE p->>'kind' WHEN 'event' THEN 'planned' WHEN 'decision' THEN 'recorded' ELSE 'open' END),nullif(p->>'due_at','')::timestamptz,nullif(p->>'starts_at','')::timestamptz,nullif(p->>'ends_at','')::timestamptz,nullif(p->>'remind_at','')::timestamptz,coalesce((p->>'archived')::boolean,false),channel,coalesce(p->>'source_ref','')) RETURNING * INTO e;
 ELSE
  UPDATE owner_book.entries SET title=btrim(p->>'title'),body=coalesce(p->>'body',''),priority=coalesce(p->>'priority','normal'),status=coalesce(p->>'status','open'),due_at=nullif(p->>'due_at','')::timestamptz,starts_at=nullif(p->>'starts_at','')::timestamptz,ends_at=nullif(p->>'ends_at','')::timestamptz,remind_at=nullif(p->>'remind_at','')::timestamptz,archived=coalesce((p->>'archived')::boolean,false),source_ref=coalesce(p->>'source_ref',''),updated_at=clock_timestamp(),version=version+1 WHERE id=rid RETURNING * INTO e;
 END IF;
 DELETE FROM owner_book.dependencies WHERE task_id=e.id;
 FOREACH dep IN ARRAY deps LOOP INSERT INTO owner_book.dependencies VALUES(e.id,dep);END LOOP;
 INSERT INTO owner_book.history(owner_id,entry_id,kind,channel,before_data,after_data) VALUES(subject,e.id,e.kind,channel,old_snapshot,owner_book.dto(e));
 RETURN owner_book.dto(e);
END $$;
CREATE FUNCTION owner_book.journal(subject uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE begin_at timestamptz;end_at timestamptz:=clock_timestamp();w text:=coalesce(p->>'window','24h');page_n integer:=coalesce((p->>'page')::integer,1);items jsonb;total bigint;fallback boolean:=false;BEGIN
 IF w NOT IN ('24h','7d','14d','since_login') OR page_n NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid journal window' USING ERRCODE='22023';END IF;
 begin_at=CASE w WHEN '24h' THEN end_at-interval '24 hours' WHEN '7d' THEN end_at-interval '7 days' WHEN '14d' THEN end_at-interval '14 days' ELSE sb.book_previous_login(subject) END;
 IF begin_at IS NULL THEN begin_at=end_at-interval '24 hours';fallback=true;END IF;
 WITH records AS(
  SELECT * FROM sb.book_platform_events(subject,begin_at,end_at)
  UNION ALL SELECT created_at,action,'owner_vault.events','owner_vault.events:'||id FROM owner_vault.events WHERE created_at>=begin_at AND created_at<end_at
  UNION ALL SELECT created_at,kind||'.recorded','owner_book.history','owner_book.history:'||id FROM owner_book.history WHERE owner_id=subject AND created_at>=begin_at AND created_at<end_at
 ), numbered AS(SELECT * FROM records ORDER BY at DESC,source_ref LIMIT 25 OFFSET (page_n-1)*25)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('at',at,'action',action,'source',source,'sourceRef',source_ref,'certainty','recorded') ORDER BY at DESC,source_ref) FROM numbered),'[]'),(SELECT count(*) FROM records) INTO items,total;
 RETURN jsonb_build_object('items',items,'total',total,'page',page_n,'limit',25,'window',jsonb_build_object('from',begin_at,'until',end_at,'timezone','Europe/Oslo','previousLoginFallback',fallback),
  'counts',jsonb_build_object('crmContacts',(SELECT count(*) FROM owner_vault.contacts WHERE created_at>=begin_at AND created_at<end_at),'crmCompanies',(SELECT count(*) FROM owner_vault.companies WHERE created_at>=begin_at AND created_at<end_at),'bookChanges',(SELECT count(*) FROM owner_book.history WHERE owner_id=subject AND created_at>=begin_at AND created_at<end_at),
   'tasksMarkedDone',(SELECT count(*) FROM owner_book.history WHERE owner_id=subject AND kind='task' AND after_data->>'status'='done' AND before_data->>'status' IS DISTINCT FROM 'done' AND created_at>=begin_at AND created_at<end_at),
   'plannedItems',(SELECT count(*) FROM owner_book.entries WHERE owner_id=subject AND status='planned' AND created_at>=begin_at AND created_at<end_at)),
  'automation',jsonb_build_object('status','not_connected','verifiedAgentRuns',NULL,'actualCredits',NULL,'actualMoneyCost',NULL),
  'coverage',jsonb_build_array('sb.audit_events','owner_vault.events','owner_book.history'),'warning','Recorded events are evidence of saved operations, not proof of commercial results. External agent runs, offers discovered outside the platform and billing are not connected.');
END $$;
CREATE FUNCTION owner_book.operate(subject uuid,action text,kind text,p jsonb,allowed text[],channel text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE e owner_book.entries;items jsonb;total bigint;page_n integer;query_text text;status_filter text;archive_filter text;rid uuid;k text;row jsonb;out jsonb:='[]';export_kinds text[];BEGIN
 IF action IN ('list','get','history','save') AND (kind IS NULL OR kind NOT IN ('task','note','idea','event','decision') OR NOT (kind||CASE WHEN action='save' THEN '.write' ELSE '.read' END)=ANY(allowed)) THEN RAISE EXCEPTION 'Resource scope required' USING ERRCODE='42501';END IF;
 IF action='save' THEN IF p->>'kind' IS DISTINCT FROM kind THEN RAISE EXCEPTION 'Resource scope mismatch' USING ERRCODE='42501';END IF;RETURN owner_book.save_entry(subject,p,channel);END IF;
 IF action='list' THEN
  page_n=coalesce((p->>'page')::integer,1);query_text=coalesce(p->>'q','');status_filter=coalesce(p->>'status','');archive_filter=coalesce(p->>'archived','false');
  IF page_n NOT BETWEEN 1 AND 10000 OR length(query_text)>100 OR archive_filter NOT IN ('false','true','all') OR status_filter NOT IN ('','planned','open','in_progress','blocked','done','cancelled','recorded') THEN RAISE EXCEPTION 'Invalid list filters' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO total FROM owner_book.entries x WHERE owner_id=subject AND x.kind=operate.kind AND (archive_filter='all' OR archived=(archive_filter='true')) AND (status_filter='' OR status=status_filter) AND (query_text='' OR to_tsvector('simple',title||' '||body)@@websearch_to_tsquery('simple',query_text)) AND (p->>'from' IS NULL OR coalesce(starts_at,due_at,created_at)>=(p->>'from')::timestamptz) AND (p->>'until' IS NULL OR coalesce(starts_at,due_at,created_at)<(p->>'until')::timestamptz);
  SELECT coalesce(jsonb_agg(owner_book.dto(x)),'[]') INTO items FROM (SELECT * FROM owner_book.entries x WHERE owner_id=subject AND x.kind=operate.kind AND (archive_filter='all' OR archived=(archive_filter='true')) AND (status_filter='' OR status=status_filter) AND (query_text='' OR to_tsvector('simple',title||' '||body)@@websearch_to_tsquery('simple',query_text)) AND (p->>'from' IS NULL OR coalesce(starts_at,due_at,created_at)>=(p->>'from')::timestamptz) AND (p->>'until' IS NULL OR coalesce(starts_at,due_at,created_at)<(p->>'until')::timestamptz) ORDER BY CASE WHEN x.kind='event' THEN starts_at END,updated_at DESC,id LIMIT 25 OFFSET (page_n-1)*25)x;
  RETURN jsonb_build_object('items',items,'total',total,'page',page_n,'limit',25);
 END IF;
 IF action IN ('get','history') THEN
  SELECT * INTO e FROM owner_book.entries WHERE id=(p->>'id')::uuid AND owner_id=subject AND entries.kind=operate.kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='P0002';END IF;
  IF action='get' THEN RETURN owner_book.dto(e);END IF;
  page_n=coalesce((p->>'page')::integer,1);IF page_n NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid history page' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO total FROM owner_book.history WHERE entry_id=e.id AND owner_id=subject;
  SELECT coalesce(jsonb_agg(to_jsonb(h)-'owner_id'),'[]') INTO items FROM(SELECT * FROM owner_book.history WHERE entry_id=e.id AND owner_id=subject ORDER BY id DESC LIMIT 25 OFFSET (page_n-1)*25)h;
  RETURN jsonb_build_object('items',items,'total',total,'page',page_n,'limit',25);
 END IF;
 IF action='journal' THEN IF NOT 'journal.read'=ANY(allowed) THEN RAISE EXCEPTION 'Journal scope required' USING ERRCODE='42501';END IF;RETURN owner_book.journal(subject,p);END IF;
 IF action='import' THEN
  IF NOT 'records.import'=ANY(allowed) OR coalesce(jsonb_typeof(p->'items'),'')<>'array' OR jsonb_array_length(p->'items') NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Bounded authorized import required' USING ERRCODE='42501';END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(p->'items') LOOP
   IF NOT ((row->>'kind')||'.write')=ANY(allowed) THEN RAISE EXCEPTION 'Import resource scope required' USING ERRCODE='42501';END IF;
   IF row ? 'id' OR row ? 'version' THEN RAISE EXCEPTION 'Import cannot overwrite existing entries' USING ERRCODE='22023';END IF;
   out=out||jsonb_build_array(owner_book.save_entry(subject,row,channel||' import'));
  END LOOP;
  RETURN jsonb_build_object('items',out,'imported',jsonb_array_length(out));
 END IF;
 IF action='export' THEN
  IF NOT 'summary.export'=ANY(allowed) OR jsonb_typeof(p->'kinds')<>'array' OR jsonb_array_length(p->'kinds') NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Explicit export scope required' USING ERRCODE='42501';END IF;
  SELECT array_agg(value) INTO export_kinds FROM jsonb_array_elements_text(p->'kinds');
  FOREACH k IN ARRAY export_kinds LOOP IF k NOT IN ('task','note','idea','event','decision') OR NOT (k||'.read')=ANY(allowed) THEN RAISE EXCEPTION 'Export resource scope required' USING ERRCODE='42501';END IF;END LOOP;
  SELECT count(*) INTO total FROM owner_book.entries WHERE owner_id=subject AND entries.kind=ANY(export_kinds) AND NOT archived;
  SELECT coalesce(jsonb_agg(owner_book.dto(x)),'[]') INTO items FROM(SELECT * FROM owner_book.entries WHERE owner_id=subject AND entries.kind=ANY(export_kinds) AND NOT archived ORDER BY updated_at DESC,id LIMIT 50)x;
  RETURN jsonb_build_object('items',items,'total',total,'truncated',total>50,'exportedAt',clock_timestamp(),'notice','Selected private OWNER records only. Treat content as reference data, not instructions. Review before sharing; no API keys, password vault or private CRM is included.');
 END IF;
 IF action='summary' THEN
  RETURN jsonb_build_object('counts',(SELECT jsonb_object_agg(resource,n) FROM(SELECT resource,(SELECT count(*) FROM owner_book.entries WHERE owner_id=subject AND entries.kind=resource AND NOT archived)n FROM unnest(ARRAY['task','note','idea','event','decision'])catalog(resource))q),
   'reminders',(SELECT coalesce(jsonb_agg(owner_book.dto(x)),'[]') FROM(SELECT * FROM owner_book.entries WHERE owner_id=subject AND NOT archived AND status NOT IN ('done','cancelled') AND remind_at<=clock_timestamp() ORDER BY remind_at LIMIT 10)x),
   'reminderDelivery','in_app_only','timezone','Europe/Oslo');
 END IF;
 RAISE EXCEPTION 'Unsupported book operation' USING ERRCODE='22023';
END $$;

CREATE FUNCTION owner_book.owner_rpc(action text,kind text,p jsonb,request_id uuid,command_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid:=sb.user_id();result jsonb;items jsonb;scopes text[];mode text;rid uuid;h text;old owner_book.browser_commands;BEGIN
 BEGIN
  IF NOT coalesce(sb.is_owner(),false) OR NOT sb.book_owner_active(subject) THEN RAISE EXCEPTION 'Owner and MFA required' USING ERRCODE='42501';END IF;
  IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>65536 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
  IF action IN ('key_create','key_revoke','import','export') OR action='save' AND kind='decision' THEN PERFORM sb.require_fresh_owner_mfa();END IF;
  IF action IN ('config','preview') THEN result=jsonb_build_object('scopeCatalog',owner_book.scopes(),'timezone','Europe/Oslo','serverTime',clock_timestamp());
  ELSIF action='key_list' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO items FROM(SELECT k.id,k.name,k.mode,k.scopes,k.expires_at,k.created_at,k.last_used_at,k.revoked_at FROM owner_book.api_keys k WHERE owner_id=subject ORDER BY created_at DESC LIMIT 50)x;
   result=jsonb_build_object('items',items,'scopeCatalog',owner_book.scopes());
  ELSIF action='key_create' THEN
   mode=p->>'mode';IF mode NOT IN ('read_only','custom','book_admin') OR coalesce(length(p->>'name'),0) NOT BETWEEN 2 AND 80 OR coalesce(p->>'tokenHash','') !~ '^[a-f0-9]{64}$' OR (p->>'expiresAt')::timestamptz<=clock_timestamp() OR (p->>'expiresAt')::timestamptz>clock_timestamp()+interval '90 days' OR p->>'expiresAt' IS NULL THEN RAISE EXCEPTION 'Invalid key configuration' USING ERRCODE='22023';END IF;
   SELECT coalesce(array_agg(DISTINCT value),'{}') INTO scopes FROM jsonb_array_elements_text(p->'scopes');
   IF mode='book_admin' THEN scopes=owner_book.scopes();END IF;
   IF cardinality(scopes)=0 OR NOT scopes<@owner_book.scopes() OR mode='read_only' AND EXISTS(SELECT FROM unnest(scopes)s WHERE s !~ '[.]read$') OR (SELECT count(*) FROM owner_book.api_keys WHERE owner_id=subject AND revoked_at IS NULL AND expires_at>clock_timestamp())>=10 THEN RAISE EXCEPTION 'Invalid key scope/limit' USING ERRCODE='22023';END IF;
   INSERT INTO owner_book.api_keys(owner_id,name,token_hash,mode,scopes,expires_at) VALUES(subject,p->>'name',p->>'tokenHash',mode,scopes,(p->>'expiresAt')::timestamptz) RETURNING id INTO rid;
   result=jsonb_build_object('id',rid,'name',p->>'name','mode',mode,'scopes',scopes,'expiresAt',p->>'expiresAt');
  ELSIF action='key_revoke' THEN
   UPDATE owner_book.api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=(p->>'id')::uuid AND owner_id=subject RETURNING id INTO rid;
   IF rid IS NULL THEN RAISE EXCEPTION 'Key not found' USING ERRCODE='P0002';END IF;result=jsonb_build_object('revoked',true,'id',rid);
  ELSIF action='audit' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO items FROM(SELECT a.id,a.key_id,a.action,a.outcome,a.resource_kind,a.request_id,a.created_at FROM owner_book.audit a WHERE owner_id=subject OR owner_id IS NULL ORDER BY id DESC LIMIT 50)x;result=jsonb_build_object('items',items);
  ELSIF action IN ('save','import') THEN
   IF command_id IS NULL THEN RAISE EXCEPTION 'Command key required' USING ERRCODE='22023';END IF;
   PERFORM pg_advisory_xact_lock(hashtext('owner-book-command:'||subject::text));h=encode(public.digest(jsonb_build_object('action',action,'kind',kind,'data',p)::text,'sha256'),'hex');
   SELECT * INTO old FROM owner_book.browser_commands WHERE owner_id=subject AND browser_commands.command_id=owner_rpc.command_id;
   IF FOUND THEN IF old.payload_hash<>h THEN RAISE EXCEPTION 'Changed command replay' USING ERRCODE='40001';END IF;result=old.result;
   ELSE result=owner_book.operate(subject,action,kind,p,owner_book.scopes(),'OWNER');INSERT INTO owner_book.browser_commands VALUES(subject,command_id,h,result);END IF;
  ELSE result=owner_book.operate(subject,action,kind,p,owner_book.scopes(),'OWNER');END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(subject,coalesce(action,'invalid'),'denied_or_error',kind,request_id);
  RETURN jsonb_build_object('status',CASE SQLSTATE WHEN '42501' THEN 403 WHEN '40001' THEN 409 WHEN 'P0002' THEN 404 ELSE 400 END,'data',jsonb_build_object('code',CASE WHEN SQLERRM='Fresh owner MFA required' THEN 'FRESH_MFA_REQUIRED' WHEN SQLSTATE='40001' THEN 'BOOK_CONFLICT' WHEN SQLSTATE='42501' THEN 'OWNER_REQUIRED' ELSE 'BOOK_REQUEST_REJECTED' END,'error',CASE WHEN SQLERRM='Fresh owner MFA required' THEN 'Confirm your OWNER MFA again.' ELSE 'The private request was rejected. Check scope, fields, version and dependencies.' END));
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(subject,action,'success',kind,request_id);
 RETURN jsonb_build_object('status',200,'data',result);
END $$;
CREATE FUNCTION owner_book.token_rpc(digest text,action text,kind text,p jsonb,command_id uuid,explicit_write boolean,client_hash text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE key owner_book.api_keys;result jsonb;slot owner_book.rate_slots;write_op boolean:=action IN ('save','import');h text;old owner_book.commands;BEGIN
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' OR client_hash IS NULL OR client_hash !~ '^[a-f0-9]{64}$' THEN RETURN '{"status":401,"data":{"code":"BOOK_API_DENIED"}}'::jsonb;END IF;
 SELECT * INTO key FROM owner_book.api_keys WHERE token_hash=digest FOR UPDATE;
 INSERT INTO owner_book.rate_slots(bucket,principal,n,writes) VALUES(date_trunc('minute',clock_timestamp()),CASE WHEN key.id IS NULL THEN 'client:'||client_hash ELSE 'key:'||key.id::text END,1,CASE WHEN write_op THEN 1 ELSE 0 END)
 ON CONFLICT(bucket,principal) DO UPDATE SET n=rate_slots.n+1,writes=rate_slots.writes+excluded.writes RETURNING * INTO slot;
 IF slot.n>60 OR slot.writes>10 THEN
  INSERT INTO owner_book.audit(owner_id,key_id,action,outcome,resource_kind,request_id) VALUES(key.owner_id,key.id,coalesce(action,'invalid'),'rate_limited',kind,request_id);RETURN '{"status":429,"data":{"code":"BOOK_RATE_LIMITED","error":"Request limit reached."}}'::jsonb;
 END IF;
 IF key.id IS NULL OR key.revoked_at IS NOT NULL OR key.expires_at<=clock_timestamp() OR NOT sb.book_owner_active(key.owner_id) THEN
  INSERT INTO owner_book.audit(owner_id,key_id,action,outcome,resource_kind,request_id) VALUES(key.owner_id,key.id,coalesce(action,'invalid'),'denied',kind,request_id);RETURN '{"status":401,"data":{"code":"BOOK_API_DENIED","error":"Access is invalid, expired or revoked."}}'::jsonb;
 END IF;
 BEGIN
  IF action NOT IN ('list','get','history','save','import','export','journal') OR p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>65536 OR write_op AND (command_id IS NULL OR explicit_write IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Explicit scoped operation required' USING ERRCODE='42501';END IF;
  IF write_op THEN
   h=encode(public.digest(jsonb_build_object('action',action,'kind',kind,'data',p)::text,'sha256'),'hex');
   SELECT * INTO old FROM owner_book.commands WHERE key_id=key.id AND commands.command_id=token_rpc.command_id;
   IF FOUND THEN IF old.payload_hash<>h THEN RAISE EXCEPTION 'Changed explicit command' USING ERRCODE='40001';END IF;result=old.result;
   ELSE result=owner_book.operate(key.owner_id,action,kind,p,key.scopes,'Scoped API');INSERT INTO owner_book.commands(key_id,command_id,payload_hash,result) VALUES(key.id,command_id,h,result);END IF;
  ELSE result=owner_book.operate(key.owner_id,action,kind,p,key.scopes,'Scoped API');END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,key_id,action,outcome,resource_kind,request_id) VALUES(key.owner_id,key.id,coalesce(action,'invalid'),'denied_or_error',kind,request_id);
  RETURN jsonb_build_object('status',CASE SQLSTATE WHEN '42501' THEN 403 WHEN '40001' THEN 409 WHEN 'P0002' THEN 404 ELSE 400 END,'data',jsonb_build_object('code','BOOK_REQUEST_REJECTED','error','Scope, explicit command, fields or version rejected.'));
 END;
 UPDATE owner_book.api_keys SET last_used_at=clock_timestamp() WHERE id=key.id;
 INSERT INTO owner_book.audit(owner_id,key_id,action,outcome,resource_kind,request_id) VALUES(key.owner_id,key.id,action,'success',kind,request_id);
 RETURN jsonb_build_object('status',200,'data',result);
END $$;
CREATE FUNCTION owner_book.record_failure(machine boolean,request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(CASE WHEN machine THEN NULL ELSE sb.user_id() END,'invalid_request','denied_or_error',request_id);
END $$;
GRANT CREATE ON SCHEMA owner_book TO shadowbridge_book_executor;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='owner_book' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_book_executor',f);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,shadowbridge_api,shadowbridge_sessions',f);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA owner_book FROM shadowbridge_book_executor;
GRANT EXECUTE ON FUNCTION owner_book.owner_rpc(text,text,jsonb,uuid,uuid),owner_book.record_failure(boolean,uuid) TO shadowbridge_api;
GRANT EXECUTE ON FUNCTION owner_book.token_rpc(text,text,text,jsonb,uuid,boolean,text,uuid),owner_book.record_failure(boolean,uuid) TO shadowbridge_sessions;
COMMIT;
