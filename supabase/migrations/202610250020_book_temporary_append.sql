-- Extend the EXISTING OAuth/MCP with separately consented, bounded append only.
-- Historical migrations, accounts, MFA, Book entries and CRM are untouched.
BEGIN;
CREATE TABLE owner_book.oauth_create_codes(code_digest text PRIMARY KEY REFERENCES owner_book.oauth_codes(digest),create_until timestamptz NOT NULL);
CREATE TABLE owner_book.oauth_create_grants(grant_id uuid PRIMARY KEY REFERENCES owner_book.oauth_grants(id),create_until timestamptz NOT NULL,create_revoked_at timestamptz,created_records integer NOT NULL DEFAULT 0 CHECK(created_records BETWEEN 0 AND 25));
-- The two original anonymous checks concern only the scope catalog/cardinality.
ALTER TABLE owner_book.oauth_grants DROP CONSTRAINT oauth_grants_scopes_check,DROP CONSTRAINT oauth_grants_scopes_check1;
ALTER TABLE owner_book.oauth_grants ADD CONSTRAINT oauth_scope_catalog CHECK(cardinality(scopes) BETWEEN 1 AND 11 AND 'note.read'=ANY(scopes) AND scopes<@ARRAY['note.read','task.read','idea.read','event.read','decision.read','journal.read','note.create','task.create','idea.create','event.create','decision.create']::text[]);

CREATE TABLE owner_book.append_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),grant_id uuid NOT NULL REFERENCES owner_book.oauth_grants(id),
 request_key uuid NOT NULL,candidate_hash text NOT NULL,snapshot_hash text NOT NULL,items jsonb NOT NULL,diff jsonb NOT NULL,
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase IN ('prepared','approved','applied','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,applied_at timestamptz,result jsonb,
 UNIQUE(owner_id,request_key),CHECK(candidate_hash~'^[a-f0-9]{64}$' AND snapshot_hash~'^[a-f0-9]{64}$'),CHECK(jsonb_array_length(items) BETWEEN 1 AND 25)
);
CREATE TABLE owner_book.append_source_keys(
 owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),source_ref text NOT NULL,entry_id uuid NOT NULL REFERENCES owner_book.entries(id),fingerprint text NOT NULL,
 PRIMARY KEY(owner_id,source_ref)
);
-- Runtime cannot certify its own backup. Only the existing operator/DBA path can
-- insert a receipt after authenticating an encrypted backup made after approval.
CREATE TABLE owner_book.append_backup_receipts(
 review_id uuid PRIMARY KEY REFERENCES owner_book.append_reviews(id),candidate_hash text NOT NULL,snapshot_hash text NOT NULL,
 archive_sha256 text NOT NULL CHECK(archive_sha256~'^[a-f0-9]{64}$'),verified_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['append_reviews','append_source_keys','append_backup_receipts','oauth_create_codes','oauth_create_grants'] LOOP
  EXECUTE format('ALTER TABLE owner_book.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE owner_book.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY append_executor ON owner_book.%I TO shadowbridge_book_executor USING(true) WITH CHECK(true)',t);
  EXECUTE format('REVOKE ALL ON owner_book.%I FROM PUBLIC,shadowbridge_api,shadowbridge_sessions',t);
  EXECUTE format('GRANT SELECT ON owner_book.%I TO shadowbridge_book_executor',t);
 END LOOP;
END $$;
GRANT INSERT,UPDATE ON owner_book.append_reviews,owner_book.append_source_keys,owner_book.oauth_create_codes,owner_book.oauth_create_grants TO shadowbridge_book_executor;

CREATE FUNCTION owner_book.append_normal(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT regexp_replace(btrim(normalize(coalesce(v,''),NFKC)),'[[:space:]]+',' ','g')
$$;
CREATE FUNCTION owner_book.append_fingerprint(p jsonb) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(public.digest(jsonb_build_array(p->>'kind',owner_book.append_normal(p->>'title'),owner_book.append_normal(p->>'body'),
 nullif(p->>'due_at','')::timestamptz,nullif(p->>'starts_at','')::timestamptz,nullif(p->>'ends_at','')::timestamptz,nullif(p->>'remind_at','')::timestamptz,
 (SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM jsonb_array_elements_text(coalesce(p->'dependencies','[]'))x))::text,'sha256'),'hex')
$$;
CREATE FUNCTION owner_book.append_snapshot(subject uuid) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(public.digest(coalesce(jsonb_agg(owner_book.dto(e) ORDER BY e.id),'[]')::text,'sha256'),'hex') FROM owner_book.entries e WHERE owner_id=subject
$$;
CREATE FUNCTION owner_book.append_diff(subject uuid,items jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p jsonb;fp text;refs uuid[];matches uuid[];titles uuid[];missing jsonb:='[]';duplicates jsonb:='[]';conflicts jsonb:='[]';seen text[]:='{}';fingerprints text[]:='{}';BEGIN
 IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Bounded import required' USING ERRCODE='22023';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF p ? 'id' OR p ? 'version' OR coalesce(length(btrim(p->>'source_ref')),0) NOT BETWEEN 1 AND 500 OR (p->>'source_ref')=ANY(seen) THEN RAISE EXCEPTION 'Distinct stable source required; no updates' USING ERRCODE='22023';END IF;
  PERFORM owner_book.validate_record(p);fp=owner_book.append_fingerprint(p);
  SELECT coalesce(array_agg(id),'{}') INTO refs FROM owner_book.entries WHERE owner_id=subject AND kind=p->>'kind' AND source_ref=p->>'source_ref';
  SELECT coalesce(array_agg(e.id),'{}') INTO matches FROM owner_book.entries e WHERE owner_id=subject AND kind=p->>'kind' AND owner_book.append_normal(title)=owner_book.append_normal(p->>'title') AND owner_book.append_fingerprint(owner_book.dto(e))=fp;
  SELECT coalesce(array_agg(id),'{}') INTO titles FROM owner_book.entries WHERE owner_id=subject AND kind=p->>'kind' AND lower(owner_book.append_normal(title))=lower(owner_book.append_normal(p->>'title'));
  IF EXISTS(SELECT FROM owner_book.entries WHERE owner_id=subject AND kind<>p->>'kind' AND source_ref=p->>'source_ref') THEN
   conflicts=conflicts||jsonb_build_array(jsonb_build_object('sourceRef',p->>'source_ref','reason','SOURCE_KIND_CONFLICT_NO_FOREIGN_IDS'));
  ELSIF cardinality(refs)>0 THEN
   IF cardinality(refs)=1 AND refs[1]=ANY(matches) THEN duplicates=duplicates||jsonb_build_array(jsonb_build_object('sourceRef',p->>'source_ref','currentId',refs[1],'preserveCurrent',true));
   ELSE conflicts=conflicts||jsonb_build_array(jsonb_build_object('sourceRef',p->>'source_ref','currentIds',refs,'reason','EXISTING_SOURCE_EDITED_OR_AMBIGUOUS_KEEP_CURRENT'));END IF;
  ELSIF cardinality(matches)=1 THEN duplicates=duplicates||jsonb_build_array(jsonb_build_object('sourceRef',p->>'source_ref','currentId',matches[1],'preserveCurrent',true));
  ELSIF cardinality(matches)>1 OR cardinality(titles)>0 OR fp=ANY(fingerprints) THEN
   conflicts=conflicts||jsonb_build_array(jsonb_build_object('sourceRef',p->>'source_ref','currentIds',titles,'reason','SAME_TITLE_OR_BATCH_CONTENT_REQUIRES_REVIEW'));
  ELSIF EXISTS(SELECT FROM owner_book.append_source_keys WHERE owner_id=subject AND source_ref=p->>'source_ref') THEN
   conflicts=conflicts||jsonb_build_array(jsonb_build_object('sourceRef',p->>'source_ref','reason','SOURCE_ALREADY_USED_KEEP_CURRENT'));
  ELSE missing=missing||jsonb_build_array(p);END IF;
  seen=array_append(seen,p->>'source_ref');fingerprints=array_append(fingerprints,fp);
 END LOOP;
 RETURN jsonb_build_object('missing',missing,'duplicates',duplicates,'conflicts',conflicts);
END $$;

-- Preserve the reviewed read-only implementation rather than reimplement auth,
-- PKCE, refresh rotation, client secrets, ownership or audit.
ALTER FUNCTION owner_book.oauth_owner(text,jsonb,uuid) RENAME TO oauth_owner_readonly_v1;
ALTER FUNCTION owner_book.oauth_machine(text,jsonb,text,uuid) RENAME TO oauth_machine_readonly_v1;
REVOKE ALL ON FUNCTION owner_book.oauth_owner_readonly_v1(text,jsonb,uuid),owner_book.oauth_machine_readonly_v1(text,jsonb,text,uuid) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;

CREATE FUNCTION owner_book.oauth_owner(action text,p jsonb,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid:=sb.user_id();scopes text[];c owner_book.oauth_clients;rid uuid;data jsonb;k text;BEGIN
 IF action NOT IN ('revoke_create','connections') AND NOT(action='authorize' AND EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(p->'scopes','[]'))s WHERE s LIKE '%.create')) THEN
  RETURN owner_book.oauth_owner_readonly_v1(action,p,request_id);END IF;
 IF NOT coalesce(sb.is_owner(),false) OR NOT sb.book_owner_active(subject) THEN RETURN '{"status":403,"data":{"code":"OWNER_MFA_REQUIRED"}}'::jsonb;END IF;
 BEGIN
  PERFORM sb.require_fresh_owner_mfa();
  IF action='connections' THEN
   SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]')) INTO data FROM(SELECT og.id,oc.name,og.scopes,og.created_at,og.expires_at,og.revoked_at,ec.create_until,ec.create_revoked_at,coalesce(ec.created_records,0) AS created_records FROM owner_book.oauth_grants og JOIN owner_book.oauth_clients oc ON oc.id=og.client_id LEFT JOIN owner_book.oauth_create_grants ec ON ec.grant_id=og.id WHERE og.owner_id=subject ORDER BY og.created_at DESC LIMIT 50)x;
  ELSIF action='revoke_create' THEN
   UPDATE owner_book.oauth_create_grants ec SET create_revoked_at=coalesce(create_revoked_at,now()) FROM owner_book.oauth_grants og WHERE ec.grant_id=og.id AND og.id=(p->>'id')::uuid AND og.owner_id=subject RETURNING og.id INTO rid;
   IF rid IS NULL THEN RAISE EXCEPTION 'Unknown connection' USING ERRCODE='22023';END IF;data='{"createRevoked":true,"readPreserved":true}';
  ELSE
   SELECT array_agg(value) INTO scopes FROM jsonb_array_elements_text(p->'scopes');
   SELECT * INTO c FROM owner_book.oauth_clients WHERE id=p->>'client_id' AND expires_at>now();
   IF p->>'temporaryCreateConsent' IS DISTINCT FROM 'true' OR c.id IS NULL OR coalesce(p->>'redirect_uri','')<>ALL(c.redirects) OR p->>'resource' IS DISTINCT FROM 'https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp' OR coalesce(p->>'challenge','')!~'^[A-Za-z0-9_-]{43}$' OR NOT('note.read'=ANY(scopes)) OR cardinality(scopes)>11 OR NOT(scopes<@ARRAY['note.read','task.read','idea.read','event.read','decision.read','journal.read','note.create','task.create','idea.create','event.create','decision.create']::text[]) THEN RAISE EXCEPTION 'Explicit temporary consent required' USING ERRCODE='42501';END IF;
   FOREACH k IN ARRAY ARRAY['note','idea','task','event','decision'] LOOP IF k||'.create'=ANY(scopes) AND NOT(k||'.read'=ANY(scopes)) THEN RAISE EXCEPTION 'Matching read scope required' USING ERRCODE='42501';END IF;END LOOP;
   IF (SELECT count(*) FROM owner_book.oauth_codes WHERE owner_id=subject AND expires_at>now())>=20 OR (SELECT count(*) FROM owner_book.oauth_grants WHERE owner_id=subject AND revoked_at IS NULL AND expires_at>now())>=10 THEN RAISE EXCEPTION 'Connection limit' USING ERRCODE='42501';END IF;
   INSERT INTO owner_book.oauth_codes(digest,flow_hash,owner_id,client_id,redirect_uri,challenge,scopes,resource) VALUES(p->>'code_hash',p->>'flow_hash',subject,c.id,p->>'redirect_uri',p->>'challenge',scopes,p->>'resource');INSERT INTO owner_book.oauth_create_codes VALUES(p->>'code_hash',clock_timestamp()+interval '60 minutes');data='{"authorized":true,"createMaxRecords":25,"createMaxMinutes":60}';
  END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'denied_or_error',request_id);
  RETURN jsonb_build_object('status',403,'data',jsonb_build_object('code',CASE WHEN SQLERRM='Fresh owner MFA required' THEN 'FRESH_MFA_REQUIRED' ELSE 'OAUTH_CONSENT_DENIED' END));
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'success',request_id);RETURN jsonb_build_object('status',200,'data',data);
END $$;
CREATE FUNCTION owner_book.oauth_machine(action text,p jsonb,client_hash text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;BEGIN
 r=owner_book.oauth_machine_readonly_v1(action,p,client_hash,request_id);
 IF action='token' AND r->>'status'='200' THEN
  INSERT INTO owner_book.oauth_create_grants(grant_id,create_until) SELECT a.grant_id,ec.create_until FROM owner_book.oauth_codes c JOIN owner_book.oauth_create_codes ec ON ec.code_digest=c.digest JOIN owner_book.oauth_access a ON a.grant_id=c.grant_id WHERE c.digest=p->>'code_hash' AND a.digest=p->>'access_hash';
 END IF;RETURN r;
END $$;

CREATE FUNCTION owner_book.append_owner(action text,p jsonb,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid:=sb.user_id();r owner_book.append_reviews;g owner_book.oauth_grants;w owner_book.oauth_create_grants;BEGIN
 IF NOT coalesce(sb.is_owner(),false) OR NOT sb.book_owner_active(subject) THEN RETURN '{"status":403,"data":{"code":"OWNER_MFA_REQUIRED"}}'::jsonb;END IF;
 BEGIN
  PERFORM sb.require_fresh_owner_mfa();
  SELECT * INTO r FROM owner_book.append_reviews WHERE id=(p->>'id')::uuid AND owner_id=subject FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Review not found' USING ERRCODE='42501';END IF;
  SELECT * INTO g FROM owner_book.oauth_grants WHERE id=r.grant_id;SELECT * INTO w FROM owner_book.oauth_create_grants WHERE grant_id=g.id;
  IF action='approve' THEN
   IF p->>'confirm' IS DISTINCT FROM 'true' OR p->>'candidateHash' IS DISTINCT FROM r.candidate_hash OR p->>'snapshotHash' IS DISTINCT FROM r.snapshot_hash OR r.phase<>'prepared' OR g.revoked_at IS NOT NULL OR w.create_revoked_at IS NOT NULL OR w.create_until IS NULL OR w.create_until<=now() OR jsonb_array_length(r.diff->'conflicts')>0 OR owner_book.append_snapshot(subject)<>r.snapshot_hash THEN RAISE EXCEPTION 'Preview changed, expired or unresolved' USING ERRCODE='42501';END IF;
   UPDATE owner_book.append_reviews SET phase='approved',approved_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  ELSIF action<>'read' THEN RAISE EXCEPTION 'Unsupported review action' USING ERRCODE='42501';END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'append.'||action,'denied_or_error',request_id);RETURN '{"status":403,"data":{"code":"APPEND_REVIEW_DENIED"}}'::jsonb;
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'append.'||action,'success',request_id);
 RETURN jsonb_build_object('status',200,'data',to_jsonb(r)-'owner_id'-'grant_id'||jsonb_build_object('backupVerified',EXISTS(SELECT FROM owner_book.append_backup_receipts WHERE review_id=r.id AND verified_at>=r.approved_at)));
END $$;

CREATE FUNCTION owner_book.append_rpc(action text,p jsonb,client_hash text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g owner_book.oauth_grants;w owner_book.oauth_create_grants;r owner_book.append_reviews;access owner_book.oauth_access;item jsonb;k text;h text;snap text;diff jsonb;slot owner_book.rate_slots;allowed text[]:=ARRAY['records.import'];n integer;output jsonb;BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>65536 OR client_hash IS NULL OR client_hash!~'^[a-f0-9]{64}$' THEN RETURN '{"status":400,"data":{"code":"APPEND_INVALID_INPUT"}}';END IF;
 SELECT * INTO access FROM owner_book.oauth_access WHERE digest=p->>'token_hash';SELECT * INTO g FROM owner_book.oauth_grants WHERE id=access.grant_id FOR UPDATE;
 IF access.digest IS NULL OR access.expires_at<=now() OR g.revoked_at IS NOT NULL OR g.expires_at<=now() OR g.resource IS DISTINCT FROM 'https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp' OR NOT sb.book_owner_active(g.owner_id) THEN RETURN '{"status":401,"data":{"code":"BOOK_API_DENIED"}}';END IF;
 SELECT * INTO w FROM owner_book.oauth_create_grants WHERE grant_id=g.id FOR UPDATE;
 IF w.create_until IS NULL THEN INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'append.'||action,'scope_required',request_id);RETURN '{"status":403,"data":{"code":"APPEND_SCOPE_REQUIRED"}}';END IF;
 IF w.create_until<=now() OR w.create_revoked_at IS NOT NULL THEN INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'append.'||action,'temporary_access_expired',request_id);RETURN '{"status":403,"data":{"code":"APPEND_TEMPORARY_ACCESS_EXPIRED"}}';END IF;
 INSERT INTO owner_book.rate_slots(bucket,principal,n) VALUES(date_trunc('minute',now()),'append:'||g.id,1) ON CONFLICT(bucket,principal) DO UPDATE SET n=rate_slots.n+1 RETURNING * INTO slot;
 IF slot.n>10 THEN RETURN '{"status":429,"data":{"code":"BOOK_RATE_LIMITED"}}';END IF;
 BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('owner-book-command:'||g.owner_id::text));
  IF action='preview' THEN
   IF (SELECT count(*) FROM owner_book.entries WHERE owner_id=g.owner_id)>10000 THEN RAISE EXCEPTION 'Complete comparison exceeds bounded review' USING ERRCODE='42501';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p->'items') LOOP
    k=item->>'kind';IF k IS NULL OR NOT(k||'.create'=ANY(g.scopes)) OR NOT(k||'.read'=ANY(g.scopes)) THEN RAISE EXCEPTION 'Create scope required' USING ERRCODE='42501';END IF;
   END LOOP;
   h=encode(public.digest((p->'items')::text,'sha256'),'hex');SELECT * INTO r FROM owner_book.append_reviews WHERE owner_id=g.owner_id AND request_key=(p->>'requestKey')::uuid;
   IF r.id IS NOT NULL THEN IF r.candidate_hash<>h OR r.grant_id<>g.id THEN RAISE EXCEPTION 'Changed command or grant' USING ERRCODE='40001';END IF;
   ELSE
    diff=owner_book.append_diff(g.owner_id,p->'items');snap=owner_book.append_snapshot(g.owner_id);
    INSERT INTO owner_book.append_reviews(owner_id,grant_id,request_key,candidate_hash,snapshot_hash,items,diff) VALUES(g.owner_id,g.id,(p->>'requestKey')::uuid,h,snap,p->'items',diff) RETURNING * INTO r;
   END IF;
  ELSIF action='apply' THEN
   SELECT * INTO r FROM owner_book.append_reviews WHERE id=(p->>'reviewId')::uuid AND owner_id=g.owner_id AND grant_id=g.id FOR UPDATE;
   IF r.id IS NULL THEN RAISE EXCEPTION 'Review not found' USING ERRCODE='42501';END IF;
   IF r.phase='applied' THEN RETURN jsonb_build_object('status',200,'data',r.result||'{"replayed":true}'::jsonb);END IF;
   IF r.phase<>'approved' OR r.approved_at IS NULL OR NOT EXISTS(SELECT FROM owner_book.append_backup_receipts b WHERE b.review_id=r.id AND b.candidate_hash=r.candidate_hash AND b.snapshot_hash=r.snapshot_hash AND b.verified_at>=r.approved_at) THEN RAISE EXCEPTION 'OWNER approval and authenticated backup required' USING ERRCODE='42501';END IF;
   -- Blocks competing legacy INSERT/UPDATE while verifying the reviewed snapshot.
   PERFORM set_config('lock_timeout','5000',true);LOCK TABLE owner_book.entries IN SHARE ROW EXCLUSIVE MODE;
   IF owner_book.append_snapshot(g.owner_id)<>r.snapshot_hash THEN RAISE EXCEPTION 'Book changed; prepare a new preview' USING ERRCODE='40001';END IF;
   diff=owner_book.append_diff(g.owner_id,r.items);IF diff<>r.diff OR jsonb_array_length(diff->'conflicts')>0 THEN RAISE EXCEPTION 'Comparison changed' USING ERRCODE='40001';END IF;
   n=jsonb_array_length(diff->'missing');IF w.created_records+n>25 THEN RAISE EXCEPTION 'Temporary creation cap exceeded' USING ERRCODE='42501';END IF;
   FOREACH k IN ARRAY ARRAY['note','idea','task','event','decision'] LOOP IF k||'.create'=ANY(g.scopes) THEN allowed=array_append(allowed,k||'.write');END IF;END LOOP;
   IF n>0 THEN output=owner_book.operate(g.owner_id,'import',NULL,jsonb_build_object('items',diff->'missing'),allowed,'OWNER approved temporary MCP append');ELSE output='{"items":[],"imported":0}';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(output->'items') LOOP INSERT INTO owner_book.append_source_keys VALUES(g.owner_id,item->>'source_ref',(item->>'id')::uuid,owner_book.append_fingerprint(item));END LOOP;
   UPDATE owner_book.oauth_create_grants SET created_records=created_records+n WHERE grant_id=g.id;
   output=output||jsonb_build_object('reviewId',r.id,'duplicatesSkipped',jsonb_array_length(diff->'duplicates'),'readBackRequired',true,'existingEntriesChanged',false);
   UPDATE owner_book.append_reviews SET phase='applied',applied_at=clock_timestamp(),result=output WHERE id=r.id RETURNING * INTO r;
  ELSE RAISE EXCEPTION 'Only preview/apply supported' USING ERRCODE='42501';END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'append.'||coalesce(action,'invalid'),'denied_or_error',request_id);
  RETURN jsonb_build_object('status',CASE SQLSTATE WHEN '40001' THEN 409 ELSE 403 END,'data',jsonb_build_object('code',CASE WHEN SQLSTATE='40001' THEN 'APPEND_PREVIEW_STALE' WHEN SQLERRM='Create scope required' THEN 'APPEND_SCOPE_REQUIRED' ELSE 'APPEND_APPROVAL_BACKUP_OR_SCOPE_REQUIRED' END));
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'append.'||action,'success',request_id);
 RETURN jsonb_build_object('status',200,'data',CASE WHEN action='apply' THEN r.result ELSE jsonb_build_object('reviewId',r.id,'phase',r.phase,'candidateHash',r.candidate_hash,'snapshotHash',r.snapshot_hash,'diff',r.diff,'approved',r.approved_at IS NOT NULL,'created',false,'reviewUrl','https://shadow-bridge.eu/oauth/owner-book/imports/'||r.id::text) END);
END $$;

GRANT CREATE ON SCHEMA owner_book TO shadowbridge_book_executor;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='owner_book' AND p.proname IN ('append_normal','append_fingerprint','append_snapshot','append_diff','append_owner','append_rpc','oauth_owner','oauth_machine') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_book_executor',f);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,shadowbridge_api,shadowbridge_sessions',f);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA owner_book FROM shadowbridge_book_executor;
GRANT EXECUTE ON FUNCTION owner_book.oauth_owner(text,jsonb,uuid),owner_book.append_owner(text,jsonb,uuid) TO shadowbridge_api;
GRANT EXECUTE ON FUNCTION owner_book.oauth_machine(text,jsonb,text,uuid),owner_book.append_rpc(text,jsonb,text,uuid) TO shadowbridge_sessions;

-- Preview the REAL existing CRM intake identity keys. No Book scope, delegated
-- CRM access, new CRM table, contact edits or automatic verification is added.
CREATE FUNCTION owner_vault.preview_intake(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company_uuid uuid;ids uuid[];matched owner_vault.contacts;registry text;profile_key text;email_key text;outcome text;why text;BEGIN
 PERFORM owner_vault.require_owner(true);PERFORM owner_vault.validate_intake(p);
 registry=upper(btrim(coalesce(p#>>'{company,registrationNumber}','')));
 IF registry<>'' THEN SELECT id INTO company_uuid FROM owner_vault.companies WHERE country=p#>>'{company,country}' AND registration_number=registry;END IF;
 profile_key=rtrim(coalesce(p#>>'{contact,professionalUrl}',''),'/');
 IF company_uuid IS NOT NULL AND owner_vault.individual_email(p->'contact') THEN email_key=lower(p#>>'{contact,workEmail}')||':'||company_uuid::text;END IF;
 SELECT coalesce(array_agg(DISTINCT contact_id),'{}'::uuid[]) INTO ids FROM owner_vault.identity_keys WHERE (kind='source' AND key=(p#>>'{source,system}')||':'||(p#>>'{source,recordId}')) OR (kind='professional' AND profile_key<>'' AND key=profile_key) OR (kind='email_company' AND key=email_key);
 IF cardinality(ids)>1 THEN outcome='review_required';why='conflicting_identity_keys';
 ELSIF cardinality(ids)=1 THEN
  SELECT * INTO matched FROM owner_vault.contacts WHERE id=ids[1];
  IF company_uuid IS NULL OR matched.company_id<>company_uuid OR lower(matched.full_name)<>lower(btrim(p#>>'{contact,fullName}')) OR (matched.work_email<>'' AND coalesce(p#>>'{contact,workEmail}','')<>'' AND lower(matched.work_email)<>lower(p#>>'{contact,workEmail}')) THEN outcome='review_required';why='identity_details_changed';
  ELSE outcome='duplicate_prevented';why='strong_identity_match';END IF;
 ELSE outcome='new_record';why='no_strong_identity_match';END IF;
 INSERT INTO owner_vault.events(action,actor_id,reason_code) VALUES('intake.preview',sb.user_id(),why);
 RETURN jsonb_build_object('previewOnly',true,'outcome',outcome,'reason',why,'candidateIds',ids,'companyId',company_uuid,'verified',false,'approvalRequired',true);
END $$;
GRANT CREATE ON SCHEMA owner_vault TO shadowbridge_vault_executor;
ALTER FUNCTION owner_vault.preview_intake(jsonb) OWNER TO shadowbridge_vault_executor;
REVOKE CREATE ON SCHEMA owner_vault FROM shadowbridge_vault_executor;
REVOKE ALL ON FUNCTION owner_vault.preview_intake(jsonb) FROM PUBLIC,shadowbridge_sessions,shadowbridge_vault_ingest;
GRANT EXECUTE ON FUNCTION owner_vault.preview_intake(jsonb) TO shadowbridge_api;
COMMIT;
