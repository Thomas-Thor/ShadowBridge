-- Additive OAuth delegation for the EXISTING read-only MCP. No account/MFA edits.
BEGIN;
CREATE TABLE owner_book.oauth_clients (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 redirects text[] NOT NULL, auth_method text NOT NULL CHECK(auth_method IN ('none','client_secret_post','client_secret_basic')),
 secret_hash text, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK(cardinality(redirects) BETWEEN 1 AND 2),
 CHECK(redirects <@ ARRAY['https://chatgpt.com/connector_platform_oauth_redirect','https://platform.openai.com/apps-manage/oauth']::text[]),
 CHECK((auth_method='none' AND secret_hash IS NULL) OR (auth_method<>'none' AND secret_hash~'^[a-f0-9]{64}$'))
);
CREATE TABLE owner_book.oauth_codes (
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'), flow_hash text UNIQUE NOT NULL CHECK(flow_hash~'^[a-f0-9]{64}$'),
 owner_id uuid NOT NULL REFERENCES sb.accounts(user_id), client_id text NOT NULL REFERENCES owner_book.oauth_clients(id),
 redirect_uri text NOT NULL, challenge text NOT NULL CHECK(challenge~'^[A-Za-z0-9_-]{43}$'),
 scopes text[] NOT NULL, resource text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '120 seconds',
 consumed_at timestamptz, grant_id uuid
);
CREATE TABLE owner_book.oauth_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),
 client_id text NOT NULL REFERENCES owner_book.oauth_clients(id),scopes text[] NOT NULL,resource text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',revoked_at timestamptz,
 CHECK(cardinality(scopes) BETWEEN 1 AND 6 AND 'note.read'=ANY(scopes)),
 CHECK(scopes <@ ARRAY['note.read','task.read','idea.read','event.read','decision.read','journal.read']::text[])
);
CREATE TABLE owner_book.oauth_access (
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'),grant_id uuid NOT NULL REFERENCES owner_book.oauth_grants(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE TABLE owner_book.oauth_refresh (
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'),grant_id uuid NOT NULL REFERENCES owner_book.oauth_grants(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',used_at timestamptz
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['oauth_clients','oauth_codes','oauth_grants','oauth_access','oauth_refresh'] LOOP
  EXECUTE format('ALTER TABLE owner_book.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE owner_book.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY oauth_executor ON owner_book.%I TO shadowbridge_book_executor USING(true) WITH CHECK(true)',t);
  EXECUTE format('REVOKE ALL ON owner_book.%I FROM PUBLIC,shadowbridge_api,shadowbridge_sessions',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON owner_book.%I TO shadowbridge_book_executor',t);
 END LOOP;
END $$;

CREATE FUNCTION owner_book.oauth_owner(action text,p jsonb,request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject uuid:=sb.user_id();c owner_book.oauth_clients;result jsonb;rid uuid;scope_list text[];BEGIN
 IF NOT coalesce(sb.is_owner(),false) OR NOT sb.book_owner_active(subject) THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'denied',request_id);
  RETURN '{"status":403,"data":{"code":"OWNER_MFA_REQUIRED"}}'::jsonb;
 END IF;
 BEGIN
 PERFORM sb.require_fresh_owner_mfa();
 IF action='context' THEN result='{"eligible":true}'::jsonb;
 ELSIF action='connections' THEN
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]')) INTO result FROM
   (SELECT og.id,oc.name,og.scopes,og.created_at,og.expires_at,og.revoked_at FROM owner_book.oauth_grants og JOIN owner_book.oauth_clients oc ON oc.id=og.client_id WHERE og.owner_id=subject ORDER BY og.created_at DESC LIMIT 50)x;
 ELSIF action='revoke' THEN
  UPDATE owner_book.oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=(p->>'id')::uuid AND owner_id=subject RETURNING id INTO rid;
  IF rid IS NULL THEN RAISE EXCEPTION 'Unknown connection' USING ERRCODE='22023';END IF;
  result='{"revoked":true}'::jsonb;
 ELSIF action='authorize' THEN
  SELECT * INTO c FROM owner_book.oauth_clients WHERE id=p->>'client_id' AND expires_at>now();
  SELECT array_agg(value) INTO scope_list FROM jsonb_array_elements_text(p->'scopes');
  IF c.id IS NULL OR coalesce(p->>'redirect_uri','')<>ALL(c.redirects) OR
    p->>'resource' IS DISTINCT FROM 'https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp' OR
    scope_list IS NULL OR cardinality(scope_list) NOT BETWEEN 1 AND 6 OR NOT ('note.read'=ANY(scope_list)) OR
    NOT (scope_list <@ ARRAY['note.read','task.read','idea.read','event.read','decision.read','journal.read']::text[]) OR
    coalesce(p->>'challenge','') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'Invalid delegation' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM owner_book.oauth_codes WHERE owner_id=subject AND expires_at>now())>=20 OR
     (SELECT count(*) FROM owner_book.oauth_grants WHERE owner_id=subject AND revoked_at IS NULL AND expires_at>now())>=10 THEN
   RAISE EXCEPTION 'Connection limit' USING ERRCODE='22023';END IF;
  INSERT INTO owner_book.oauth_codes(digest,flow_hash,owner_id,client_id,redirect_uri,challenge,scopes,resource)
   VALUES(p->>'code_hash',p->>'flow_hash',subject,c.id,p->>'redirect_uri',p->>'challenge',scope_list,p->>'resource');
  result='{"authorized":true}'::jsonb;
 ELSE RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023';END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'denied_or_error',request_id);
  RETURN jsonb_build_object('status',403,'data',jsonb_build_object('code',CASE WHEN SQLERRM='Fresh owner MFA required' THEN 'FRESH_MFA_REQUIRED' ELSE 'OAUTH_CONSENT_DENIED' END));
 END;
 INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(subject,'oauth.'||action,'success',request_id);
 RETURN jsonb_build_object('status',200,'data',result);
END $$;

CREATE FUNCTION owner_book.oauth_machine(action text,p jsonb,client_hash text,request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c owner_book.oauth_clients;code owner_book.oauth_codes;g owner_book.oauth_grants;rt owner_book.oauth_refresh;
 at owner_book.oauth_access;slot owner_book.rate_slots;result jsonb;op text;k text;BEGIN
 IF client_hash IS NULL OR client_hash !~ '^[a-f0-9]{64}$' OR p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>16000 THEN
  RETURN '{"status":400,"data":{"error":"invalid_request"}}'::jsonb;END IF;
 INSERT INTO owner_book.rate_slots(bucket,principal,n) VALUES(date_trunc('minute',clock_timestamp()),'oauth:'||action||':'||client_hash,1)
 ON CONFLICT(bucket,principal) DO UPDATE SET n=rate_slots.n+1 RETURNING * INTO slot;
 IF slot.n>(CASE WHEN action='register' THEN 5 ELSE 60 END) THEN INSERT INTO owner_book.audit(action,outcome,request_id) VALUES('oauth.'||action,'rate_limited',request_id);RETURN '{"status":429,"data":{"error":"slow_down"}}'::jsonb;END IF;
 IF action='register' THEN
  PERFORM pg_advisory_xact_lock(hashtext('owner-book-oauth-client-cap'));
  IF (SELECT count(*) FROM owner_book.oauth_clients WHERE expires_at>now())>=256 THEN RETURN '{"status":429,"data":{"error":"registration_limit"}}'::jsonb;END IF;
  INSERT INTO owner_book.oauth_clients(id,name,redirects,auth_method,secret_hash)
   VALUES(p->>'id',p->>'name',ARRAY(SELECT jsonb_array_elements_text(p->'redirects')),p->>'auth_method',p->>'secret_hash');
  result='{}'::jsonb;
 ELSE
  SELECT * INTO c FROM owner_book.oauth_clients WHERE id=p->>'client_id' AND expires_at>now();
  IF action='client' THEN
   IF c.id IS NULL THEN RETURN '{"status":400,"data":{"error":"invalid_client"}}'::jsonb;END IF;
   RETURN jsonb_build_object('status',200,'data',jsonb_build_object('name',c.name,'redirects',c.redirects));
  END IF;
  IF action<>'read' AND (c.id IS NULL OR c.auth_method<>coalesce(p->>'auth_method','none') OR c.secret_hash IS DISTINCT FROM p->>'secret_hash') THEN
   INSERT INTO owner_book.audit(action,outcome,request_id) VALUES('oauth.'||action,'invalid_client',request_id);RETURN '{"status":401,"data":{"error":"invalid_client"}}'::jsonb;END IF;
  IF action='token' THEN
   SELECT * INTO code FROM owner_book.oauth_codes WHERE digest=p->>'code_hash' FOR UPDATE;
   IF code.digest IS NOT NULL AND code.consumed_at IS NOT NULL AND code.client_id=c.id AND code.challenge=p->>'challenge' THEN
    UPDATE owner_book.oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=code.grant_id;
    INSERT INTO owner_book.audit(action,outcome,request_id) VALUES('oauth.'||action,'invalid_grant',request_id);RETURN '{"status":400,"data":{"error":"invalid_grant"}}'::jsonb;
   END IF;
   IF code.digest IS NULL OR code.consumed_at IS NOT NULL OR code.expires_at<=now() OR code.client_id IS DISTINCT FROM c.id OR code.redirect_uri IS DISTINCT FROM p->>'redirect_uri' OR
     code.challenge IS DISTINCT FROM p->>'challenge' OR code.resource IS DISTINCT FROM p->>'resource' OR NOT sb.book_owner_active(code.owner_id) THEN
    INSERT INTO owner_book.audit(action,outcome,request_id) VALUES('oauth.'||action,'invalid_grant',request_id);RETURN '{"status":400,"data":{"error":"invalid_grant"}}'::jsonb;END IF;
   INSERT INTO owner_book.oauth_grants(owner_id,client_id,scopes,resource) VALUES(code.owner_id,c.id,code.scopes,code.resource) RETURNING * INTO g;
   UPDATE owner_book.oauth_codes SET consumed_at=now(),grant_id=g.id WHERE digest=code.digest;
  ELSIF action='refresh' THEN
   SELECT * INTO rt FROM owner_book.oauth_refresh WHERE digest=p->>'refresh_hash';
   SELECT * INTO g FROM owner_book.oauth_grants WHERE id=rt.grant_id FOR UPDATE;
   SELECT * INTO rt FROM owner_book.oauth_refresh WHERE digest=p->>'refresh_hash' FOR UPDATE;
   IF rt.digest IS NOT NULL AND rt.used_at IS NOT NULL AND g.client_id=c.id THEN
    UPDATE owner_book.oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=g.id;
    INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'oauth.refresh','replay_revoked',request_id);
    INSERT INTO owner_book.audit(action,outcome,request_id) VALUES('oauth.'||action,'invalid_grant',request_id);RETURN '{"status":400,"data":{"error":"invalid_grant"}}'::jsonb;END IF;
   IF rt.digest IS NULL OR rt.expires_at<=now() OR g.revoked_at IS NOT NULL OR g.expires_at<=now() OR g.client_id<>c.id OR
     g.resource IS DISTINCT FROM p->>'resource' OR NOT sb.book_owner_active(g.owner_id) THEN INSERT INTO owner_book.audit(action,outcome,request_id) VALUES('oauth.'||action,'invalid_grant',request_id);RETURN '{"status":400,"data":{"error":"invalid_grant"}}'::jsonb;END IF;
   UPDATE owner_book.oauth_refresh SET used_at=now() WHERE digest=rt.digest;
  ELSIF action='revoke' THEN
   SELECT * INTO g FROM owner_book.oauth_grants WHERE id IN
    (SELECT grant_id FROM owner_book.oauth_refresh WHERE digest=p->>'token_hash' UNION SELECT grant_id FROM owner_book.oauth_access WHERE digest=p->>'token_hash') AND client_id=c.id;
   IF g.id IS NOT NULL THEN UPDATE owner_book.oauth_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=g.id;END IF;
   result='{}'::jsonb;
  ELSIF action='read' THEN
   SELECT * INTO at FROM owner_book.oauth_access WHERE digest=p->>'token_hash';
   SELECT * INTO g FROM owner_book.oauth_grants WHERE id=at.grant_id FOR UPDATE;
   IF at.digest IS NULL OR at.expires_at<=now() OR g.revoked_at IS NOT NULL OR g.expires_at<=now() OR
     g.resource IS DISTINCT FROM p->>'resource' OR NOT sb.book_owner_active(g.owner_id) THEN
    INSERT INTO owner_book.audit(owner_id,action,outcome,request_id) VALUES(g.owner_id,'oauth.read','denied',request_id);
    RETURN '{"status":401,"data":{"code":"BOOK_API_DENIED"}}'::jsonb;END IF;
   INSERT INTO owner_book.rate_slots(bucket,principal,n) VALUES(date_trunc('minute',clock_timestamp()),'oauth-grant:'||g.id,1)
   ON CONFLICT(bucket,principal) DO UPDATE SET n=rate_slots.n+1 RETURNING * INTO slot;
   IF slot.n>60 THEN RETURN '{"status":429,"data":{"code":"BOOK_RATE_LIMITED"}}'::jsonb;END IF;
   op=p->>'action';k=p->>'kind';
   BEGIN
    IF op IS NULL OR op NOT IN ('list','get','journal') OR op<>'journal' AND (k IS NULL OR k NOT IN ('note','task','idea','event','decision')) OR jsonb_typeof(p->'params') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Read only' USING ERRCODE='42501';END IF;
    result=owner_book.operate(g.owner_id,op,k,p->'params',g.scopes,'OAuth MCP read-only');
   EXCEPTION WHEN OTHERS THEN
    INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(g.owner_id,'oauth.'||coalesce(op,'invalid'),'denied_or_error',k,request_id);
    RETURN jsonb_build_object('status',CASE SQLSTATE WHEN 'P0002' THEN 404 ELSE 403 END,'data',jsonb_build_object('code','BOOK_SCOPE_DENIED'));
   END;
  ELSE RETURN '{"status":400,"data":{"error":"unsupported_grant_type"}}'::jsonb;END IF;
  IF action IN ('token','refresh') THEN
   INSERT INTO owner_book.oauth_access(digest,grant_id,expires_at) VALUES(p->>'access_hash',g.id,least(g.expires_at,now()+interval '10 minutes'));
   INSERT INTO owner_book.oauth_refresh(digest,grant_id,expires_at) VALUES(p->>'next_refresh_hash',g.id,g.expires_at);
   result=jsonb_build_object('scope',array_to_string(g.scopes,' '),'expires_in',least(600,extract(epoch FROM g.expires_at-now())::integer));
  END IF;
 END IF;
 INSERT INTO owner_book.audit(owner_id,action,outcome,resource_kind,request_id) VALUES(g.owner_id,'oauth.'||action,'success',k,request_id);
 RETURN jsonb_build_object('status',200,'data',result);
END $$;
GRANT CREATE ON SCHEMA owner_book TO shadowbridge_book_executor;
ALTER FUNCTION owner_book.oauth_owner(text,jsonb,uuid) OWNER TO shadowbridge_book_executor;
ALTER FUNCTION owner_book.oauth_machine(text,jsonb,text,uuid) OWNER TO shadowbridge_book_executor;
REVOKE CREATE ON SCHEMA owner_book FROM shadowbridge_book_executor;
REVOKE ALL ON FUNCTION owner_book.oauth_owner(text,jsonb,uuid),owner_book.oauth_machine(text,jsonb,text,uuid) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION owner_book.oauth_owner(text,jsonb,uuid) TO shadowbridge_api;
GRANT EXECUTE ON FUNCTION owner_book.oauth_machine(text,jsonb,text,uuid) TO shadowbridge_sessions;
COMMIT;
