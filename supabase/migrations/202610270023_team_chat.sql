BEGIN;
CREATE TABLE command_center.rooms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 120),
 kind text NOT NULL DEFAULT 'team' CHECK(kind IN ('team','assistant')),created_by uuid NOT NULL REFERENCES sb.accounts(user_id),
 archived boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE command_center.room_members(
 room_id uuid NOT NULL REFERENCES command_center.rooms(id),user_id uuid NOT NULL REFERENCES sb.accounts(user_id),
 can_write boolean NOT NULL DEFAULT false,can_attach boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,
 history_from timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(room_id,user_id)
);
CREATE TABLE command_center.messages(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,room_id uuid NOT NULL REFERENCES command_center.rooms(id),
 sender_id uuid NOT NULL REFERENCES sb.accounts(user_id),body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 8000),
 request_key uuid NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(sender_id,request_key)
);
CREATE INDEX command_message_page ON command_center.messages(room_id,id DESC);
CREATE INDEX command_members_by_user ON command_center.room_members(user_id,room_id) WHERE active;
CREATE TABLE command_center.room_reads(room_id uuid NOT NULL REFERENCES command_center.rooms(id),user_id uuid NOT NULL REFERENCES sb.accounts(user_id),message_id bigint NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id));
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['rooms','room_members','messages','room_reads'] LOOP
 EXECUTE format('ALTER TABLE command_center.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE command_center.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY internal_executor ON command_center.%I TO shadowbridge_workspace_executor USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON command_center.rooms,command_center.room_members,command_center.room_reads TO shadowbridge_workspace_executor;
GRANT SELECT,INSERT ON command_center.messages TO shadowbridge_workspace_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA command_center TO shadowbridge_workspace_executor;
CREATE FUNCTION command_center.room_allowed(target uuid,desired text DEFAULT 'read') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT desired IN ('read','write','attach') AND EXISTS(SELECT FROM command_center.rooms r WHERE r.id=target AND NOT r.archived AND
 (sb.is_owner() OR (r.kind='team' AND sb.is_staff() AND sb.has_permission('messages.read') AND EXISTS(
 SELECT FROM command_center.room_members m WHERE m.room_id=r.id AND m.user_id=sb.user_id() AND m.active AND (m.expires_at IS NULL OR m.expires_at>statement_timestamp())
 AND (desired='read' OR (m.can_write AND sb.has_permission('messages.create') AND (desired<>'attach' OR m.can_attach)))))))
$$;
CREATE FUNCTION command_center.chat_read(operation text,p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;target uuid;cursor_id bigint;BEGIN
 IF NOT sb.is_staff() THEN RAISE EXCEPTION 'Staff MFA required' USING ERRCODE='42501'; END IF;
 IF operation='rooms' THEN
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]')) INTO result FROM (
   SELECT r.id,r.title,r.kind,r.version,command_center.room_allowed(r.id,'write') AS "canWrite",command_center.room_allowed(r.id,'attach') AS "canAttach",
   (SELECT count(*) FROM command_center.messages q WHERE q.room_id=r.id AND q.id>coalesce((SELECT message_id FROM command_center.room_reads WHERE room_id=r.id AND user_id=sb.user_id()),0)
    AND (sb.is_owner() OR q.created_at>=(SELECT history_from FROM command_center.room_members WHERE room_id=r.id AND user_id=sb.user_id()))) AS unread
   FROM command_center.rooms r WHERE command_center.room_allowed(r.id) ORDER BY r.created_at DESC,r.id LIMIT 100
  ) x;RETURN result;
 END IF;
 target=(p->>'roomId')::uuid;
 IF NOT command_center.room_allowed(target) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501'; END IF;
 IF operation='members' THEN
  PERFORM command_center.require_owner();
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]')) INTO result FROM (
   SELECT user_id AS "userId",can_write AS "canWrite",can_attach AS "canAttach",active,expires_at AS "expiresAt",history_from AS "historyFrom" FROM command_center.room_members WHERE room_id=target ORDER BY user_id LIMIT 200
  ) x;RETURN result;
 ELSIF operation='messages' THEN
  cursor_id=coalesce((p->>'before')::bigint,9223372036854775807);
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id::bigint),'[]'),'nextCursor',CASE WHEN count(*)=50 THEN min(x.id::bigint)::text ELSE NULL END) INTO result FROM (
   SELECT id::text AS id,body,sender_id=sb.user_id() AS own,created_at AS "createdAt",sender_id AS "senderId" FROM command_center.messages
   WHERE room_id=target AND id<cursor_id AND (sb.is_owner() OR created_at>=(SELECT history_from FROM command_center.room_members WHERE room_id=target AND user_id=sb.user_id())) ORDER BY id DESC LIMIT 50
  ) x;RETURN result;
 END IF;
 RAISE EXCEPTION 'Unknown chat operation' USING ERRCODE='22023';
END $$;
CREATE FUNCTION command_center.chat_write(operation text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;msg command_center.messages;digest text;BEGIN
 IF operation='create' THEN
  PERFORM command_center.require_owner(true);
  INSERT INTO command_center.rooms(title,kind,created_by) VALUES(p->>'title',coalesce(p->>'kind','team'),sb.user_id()) RETURNING id INTO target;
  PERFORM command_center.record_event('chat.room_created',target::text);RETURN jsonb_build_object('id',target);
 END IF;
 target=(p->>'roomId')::uuid;
 IF operation='member' THEN
  PERFORM command_center.require_owner(true);
  IF NOT EXISTS(SELECT FROM command_center.rooms WHERE id=target AND kind='team' AND NOT archived) OR (p->>'history') NOT IN ('all','from_now')
  OR NOT EXISTS(SELECT FROM sb.accounts a JOIN sb.staff_grants g USING(user_id) WHERE a.user_id=(p->>'userId')::uuid AND a.status='active' AND a.email_verified_at IS NOT NULL AND g.active)
  OR ((p->>'expiresAt')::timestamptz IS NOT NULL AND (p->>'expiresAt')::timestamptz<=now()) THEN RAISE EXCEPTION 'Invalid member' USING ERRCODE='22023';END IF;
  INSERT INTO command_center.room_members(room_id,user_id,can_write,can_attach,active,history_from,expires_at)
  VALUES(target,(p->>'userId')::uuid,(p->>'canWrite')::boolean,(p->>'canAttach')::boolean,(p->>'active')::boolean,CASE WHEN p->>'history'='all' THEN '-infinity'::timestamptz ELSE clock_timestamp() END,(p->>'expiresAt')::timestamptz)
  ON CONFLICT(room_id,user_id) DO UPDATE SET can_write=excluded.can_write,can_attach=excluded.can_attach,active=excluded.active,history_from=excluded.history_from,expires_at=excluded.expires_at,updated_at=clock_timestamp();
  PERFORM command_center.record_event('chat.membership_changed',target::text);RETURN jsonb_build_object('saved',true);
 END IF;
 IF NOT command_center.room_allowed(target,CASE WHEN operation='send' THEN 'write' ELSE 'read' END) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501';END IF;
 IF operation='send' THEN
  digest=encode(public.digest(target::text||':'||(p->>'body'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(sb.user_id()::text||':'||(p->>'requestKey'),0));
  SELECT * INTO msg FROM command_center.messages WHERE sender_id=sb.user_id() AND request_key=(p->>'requestKey')::uuid;
  IF FOUND THEN IF msg.payload_hash<>digest THEN RAISE EXCEPTION 'Request key changed' USING ERRCODE='40001'; END IF;
  ELSE INSERT INTO command_center.messages(room_id,sender_id,body,request_key,payload_hash) VALUES(target,sb.user_id(),p->>'body',(p->>'requestKey')::uuid,digest) RETURNING * INTO msg;END IF;
  RETURN jsonb_build_object('id',msg.id::text,'body',msg.body,'createdAt',msg.created_at,'own',true);
 ELSIF operation='read' THEN
  INSERT INTO command_center.room_reads VALUES(target,sb.user_id(),coalesce((SELECT max(id) FROM command_center.messages WHERE room_id=target),0))
  ON CONFLICT(room_id,user_id) DO UPDATE SET message_id=greatest(command_center.room_reads.message_id,excluded.message_id);
  RETURN jsonb_build_object('saved',true);
 END IF;
 RAISE EXCEPTION 'Unknown chat operation' USING ERRCODE='22023';
END $$;
GRANT SELECT(user_id,email_verified_at,status) ON sb.accounts TO shadowbridge_workspace_executor;
GRANT SELECT(user_id,active) ON sb.staff_grants TO shadowbridge_workspace_executor;
CREATE POLICY workspace_staff_lookup ON sb.accounts FOR SELECT TO shadowbridge_workspace_executor USING(sb.is_owner());
CREATE POLICY workspace_staff_lookup ON sb.staff_grants FOR SELECT TO shadowbridge_workspace_executor USING(sb.is_owner());
GRANT CREATE ON SCHEMA command_center TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.room_allowed(uuid,text) OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.chat_read(text,jsonb) OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.chat_write(text,jsonb) OWNER TO shadowbridge_workspace_executor;
REVOKE CREATE ON SCHEMA command_center FROM shadowbridge_workspace_executor;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA command_center FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_center.chat_read(text,jsonb),command_center.chat_write(text,jsonb) TO shadowbridge_api;
COMMIT;
