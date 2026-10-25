-- Existing Book/OAuth only. Never upgrades an old grant or modifies old entries.
BEGIN;
ALTER TABLE owner_book.oauth_grants DROP CONSTRAINT oauth_scope_catalog;
ALTER TABLE owner_book.oauth_grants ADD CONSTRAINT oauth_scope_catalog CHECK(cardinality(scopes) BETWEEN 1 AND 16 AND 'note.read'=ANY(scopes) AND scopes<@ARRAY['note.read','task.read','idea.read','event.read','decision.read','journal.read','note.create','task.create','idea.create','event.create','decision.create','note.write','task.write','idea.write','event.write','decision.write']::text[]);
CREATE TABLE owner_book.oauth_write_revocations(grant_id uuid PRIMARY KEY REFERENCES owner_book.oauth_grants(id),revoked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE owner_book.oauth_write_commands(owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),grant_id uuid NOT NULL REFERENCES owner_book.oauth_grants(id),command_id uuid NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,command_id));
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['oauth_write_revocations','oauth_write_commands'] LOOP
  EXECUTE format('ALTER TABLE owner_book.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE owner_book.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY write_executor ON owner_book.%I TO shadowbridge_book_executor USING(true) WITH CHECK(true)',t);
  EXECUTE format('REVOKE ALL ON owner_book.%I FROM PUBLIC,shadowbridge_api,shadowbridge_sessions',t);
  EXECUTE format('GRANT SELECT,INSERT ON owner_book.%I TO shadowbridge_book_executor',t);
 END LOOP;
END $$;
ALTER FUNCTION owner_book.oauth_owner(text,jsonb,uuid) RENAME TO oauth_owner_append_v1;
REVOKE ALL ON FUNCTION owner_book.oauth_owner_append_v1(text,jsonb,uuid) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
CREATE FUNCTION owner_book.oauth_owner(action text,p jsonb,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid:=sb.user_id();scopes text[];c owner_book.oauth_clients;data jsonb;k text;rid uuid;BEGIN
 IF action NOT IN ('revoke_write','connections') AND NOT(action='authorize' AND EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(p->'scopes','[]'))s WHERE s LIKE '%.write')) THEN RETURN owner_book.oauth_owner_append_v1(action,p,request_id);END IF;
 IF NOT coalesce(sb.is_owner(),false) OR NOT sb.book_owner_active(subject) THEN RETURN '{"status":403,"data":{"code":"OWNER_MFA_REQUIRED"}}';END IF;
 BEGIN
  PERFORM sb.require_fresh_owner_mfa();
  IF action='connections' THEN
   data=owner_book.oauth_owner_append_v1(action,p,request_id);IF data->>'status'<>'200' THEN RETURN data;END IF;
   SELECT jsonb_agg(x||jsonb_build_object('write_revoked',EXISTS(SELECT FROM owner_book.oauth_write_revocations WHERE grant_id=(x->>'id')::uuid))) INTO data FROM jsonb_array_elements(data->'data'->'items')x;
   data=jsonb_build_object('items',coalesce(data,'[]'::jsonb));
  ELSIF action='revoke_write' THEN
   SELECT id INTO rid FROM owner_book.oauth_grants WHERE id=(p->>'id')::uuid AND owner_id=subject FOR UPDATE;
   IF rid IS NULL THEN RAISE EXCEPTION 'Unknown connection' USING ERRCODE='42501';END IF;
   INSERT INTO owner_book.oauth_write_revocations(grant_id) VALUES(rid) ON CONFLICT DO NOTHING;data='{"writeRevoked":true,"readPreserved":true}';
  ELSE
   SELECT array_agg(value) INTO scopes FROM jsonb_array_elements_text(p->'scopes');SELECT * INTO c FROM owner_book.oauth_clients WHERE id=p->>'client_id' AND expires_at>now();
   IF p->>'explicitWriteConsent' IS DISTINCT FROM 'true' OR c.id IS NULL OR coalesce(p->>'redirect_uri','')<>ALL(c.redirects) OR p->>'resource' IS DISTINCT FROM 'https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp' OR coalesce(p->>'challenge','')!~'^[A-Za-z0-9_-]{43}$' OR scopes IS NULL OR NOT('note.read'=ANY(scopes)) OR cardinality(scopes)>11 OR NOT(scopes<@ARRAY['note.read','task.read','idea.read','event.read','decision.read','journal.read','note.write','task.write','idea.write','event.write','decision.write']::text[]) THEN RAISE EXCEPTION 'Explicit write consent required' USING ERRCODE='42501';END IF;
   FOREACH k IN ARRAY ARRAY['note','idea','task','event','decision'] LOOP IF k||'.write'=ANY(scopes) AND NOT(k||'.read'=ANY(scopes)) THEN RAISE EXCEPTION 'Matching read scope required' USING ERRCODE='42501';END IF;END LOOP;
   IF (SELECT count(*) FROM owner_book.oauth_codes WHERE owner_id=subject AND expires_at>now())>=20 OR (SELECT count(*) FROM owner_book.oauth_grants WHERE owner_id=subject AND revoked_at IS NULL AND expires_at>now())>=10 THEN RAISE EXCEPTION 'Connection limit' USING ERRCODE='42501';END IF;
   INSERT INTO owner_book.oauth_codes(digest,flow_hash,owner_id,client_id,redirect_uri,challenge,scopes,resource) VALUES(p->>'code_hash',p->>'flow_hash',subject,c.id,p->>'redirect_uri',p->>'challenge',scopes,p->>'resource');data='{"authorized":true,"existingGrantsUpgraded":false,"bulkImport":false}';
  END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'denied_or_error',request_id);
  RETURN jsonb_build_object('status',403,'data',jsonb_build_object('code',CASE WHEN SQLERRM='Fresh owner MFA required' THEN 'FRESH_MFA_REQUIRED' ELSE 'OAUTH_CONSENT_DENIED' END));
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'success',request_id);RETURN jsonb_build_object('status',200,'data',data);
END $$;
CREATE FUNCTION owner_book.oauth_write_rpc(p jsonb,client_hash text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a owner_book.oauth_access;g owner_book.oauth_grants;slot owner_book.rate_slots;k text:=p->>'kind';command uuid;h text;old owner_book.oauth_write_commands;data jsonb;record jsonb;BEGIN
 IF client_hash IS NULL OR client_hash!~'^[a-f0-9]{64}$' OR coalesce(p->>'token_hash','')!~'^[a-f0-9]{64}$' THEN RETURN '{"status":401,"data":{"code":"BOOK_API_DENIED"}}';END IF;
 SELECT * INTO a FROM owner_book.oauth_access WHERE digest=p->>'token_hash';SELECT * INTO g FROM owner_book.oauth_grants WHERE id=a.grant_id FOR UPDATE;
 IF a.digest IS NULL OR a.expires_at<=clock_timestamp() OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR g.resource IS DISTINCT FROM p->>'resource' OR NOT sb.book_owner_active(g.owner_id) THEN INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'oauth.write','denied',request_id);RETURN '{"status":401,"data":{"code":"BOOK_API_DENIED"}}';END IF;
 INSERT INTO owner_book.rate_slots(bucket,principal,n,writes) VALUES(date_trunc('minute',clock_timestamp()),'oauth-grant:'||g.id,1,1) ON CONFLICT(bucket,principal) DO UPDATE SET n=rate_slots.n+1,writes=rate_slots.writes+1 RETURNING * INTO slot;
 IF slot.n>60 OR slot.writes>10 THEN INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(g.owner_id,'oauth.write','rate_limited',k,request_id);RETURN '{"status":429,"data":{"code":"BOOK_RATE_LIMITED"}}';END IF;
 IF k IS NULL OR k NOT IN ('note','task','idea','event','decision') OR NOT(k||'.write'=ANY(g.scopes)) OR NOT(k||'.read'=ANY(g.scopes)) OR EXISTS(SELECT FROM owner_book.oauth_write_revocations WHERE grant_id=g.id) THEN INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(g.owner_id,'oauth.write','scope_denied',k,request_id);RETURN '{"status":403,"data":{"code":"BOOK_WRITE_SCOPE_REQUIRED"}}';END IF;
 BEGIN
  IF p->>'explicitWrite' IS DISTINCT FROM 'true' OR p->>'action' NOT IN ('save','patch') OR p->>'action' IS NULL OR jsonb_typeof(p->'params') IS DISTINCT FROM 'object' OR octet_length(p::text)>65536 THEN RAISE EXCEPTION 'Explicit single-record save required' USING ERRCODE='42501';END IF;
  command=(p->>'requestKey')::uuid;IF command IS NULL THEN RAISE EXCEPTION 'Command UUID required' USING ERRCODE='42501';END IF;
  -- Same ordering as the existing temporary-import path; never compete with
  -- its table/snapshot lock while holding the entry-save lock first.
  PERFORM pg_advisory_xact_lock(hashtext('owner-book-command:'||g.owner_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('owner-book:'||g.owner_id::text));
  h=encode(public.digest(jsonb_build_object('action',p->>'action','kind',k,'data',p->'params')::text,'sha256'),'hex');SELECT * INTO old FROM owner_book.oauth_write_commands WHERE owner_id=g.owner_id AND command_id=command;
  IF FOUND THEN IF old.payload_hash<>h THEN RAISE EXCEPTION 'Changed command' USING ERRCODE='40001';END IF;data=old.result;
  ELSE
   IF p->>'action'='patch' THEN
    IF jsonb_typeof(p->'params'->'changes') IS DISTINCT FROM 'object' OR p->'params'->'changes'='{}'::jsonb OR EXISTS(SELECT FROM jsonb_object_keys(p->'params'->'changes')x WHERE x NOT IN ('title','body','priority','status','due_at','starts_at','ends_at','remind_at','archived','dependencies','source_ref')) THEN RAISE EXCEPTION 'Invalid patch fields' USING ERRCODE='42501';END IF;
    record=owner_book.operate(g.owner_id,'get',k,jsonb_build_object('id',p->'params'->>'id'),g.scopes,'OAuth MCP patch read');
    SELECT jsonb_object_agg(key,value) INTO record FROM jsonb_each(record) WHERE key IN ('kind','title','body','priority','status','due_at','starts_at','ends_at','remind_at','archived','dependencies','source_ref');
    record=record||(p->'params'->'changes')||jsonb_build_object('id',p->'params'->>'id','kind',k,'version',p->'params'->'version');
   ELSE record=p->'params';IF record ? 'id' OR record ? 'version' THEN RAISE EXCEPTION 'Create cannot overwrite' USING ERRCODE='42501';END IF;END IF;
   data=owner_book.operate(g.owner_id,'save',k,record,g.scopes,'OAuth MCP explicit write');INSERT INTO owner_book.oauth_write_commands VALUES(g.owner_id,g.id,command,h,data,clock_timestamp());
  END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(g.owner_id,'oauth.write','denied_or_error',k,request_id);
  RETURN jsonb_build_object('status',CASE SQLSTATE WHEN '40001' THEN 409 WHEN 'P0002' THEN 404 WHEN '42501' THEN 403 ELSE 400 END,'data',jsonb_build_object('code',CASE WHEN SQLSTATE='40001' THEN 'BOOK_CONFLICT' ELSE 'BOOK_WRITE_REJECTED' END,'reason',CASE WHEN SQLERRM='Incomplete dependency' THEN 'Complete prerequisite tasks first.' ELSE 'Check scope, version, fields and dependencies.' END));
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(g.owner_id,'oauth.write','success',k,request_id);RETURN jsonb_build_object('status',200,'data',data);
END $$;
GRANT CREATE ON SCHEMA owner_book TO shadowbridge_book_executor;
ALTER FUNCTION owner_book.oauth_owner(text,jsonb,uuid) OWNER TO shadowbridge_book_executor;
ALTER FUNCTION owner_book.oauth_write_rpc(jsonb,text,uuid) OWNER TO shadowbridge_book_executor;
REVOKE CREATE ON SCHEMA owner_book FROM shadowbridge_book_executor;
REVOKE ALL ON FUNCTION owner_book.oauth_owner(text,jsonb,uuid),owner_book.oauth_write_rpc(jsonb,text,uuid) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION owner_book.oauth_owner(text,jsonb,uuid) TO shadowbridge_api;
GRANT EXECUTE ON FUNCTION owner_book.oauth_write_rpc(jsonb,text,uuid) TO shadowbridge_sessions;
COMMIT;
