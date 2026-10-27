BEGIN;
CREATE TABLE command_center.contact_refs(
 key text PRIMARY KEY CHECK(length(key) BETWEEN 4 AND 200),source text NOT NULL CHECK(source IN ('sheets','vault')),source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 100),
 verified_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source,source_id)
);
CREATE TABLE command_center.files(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('contact','room','page')),parent_key text NOT NULL CHECK(length(parent_key) BETWEEN 1 AND 200),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 160),mime text NOT NULL CHECK(mime IN ('image/png','application/pdf')),
 encrypted_data bytea NOT NULL CHECK(octet_length(encrypted_data) BETWEEN 32 AND 15000000),encrypted_preview bytea NOT NULL CHECK(octet_length(encrypted_preview) BETWEEN 32 AND 15000000),
 pages integer NOT NULL CHECK(pages BETWEEN 1 AND 10),created_by uuid NOT NULL REFERENCES sb.accounts(user_id),created_at timestamptz NOT NULL DEFAULT now(),archived_at timestamptz,
 request_key uuid NOT NULL,UNIQUE(created_by,request_key)
);
CREATE INDEX command_files_parent ON command_center.files(kind,parent_key,created_at DESC,id) WHERE archived_at IS NULL;
CREATE TABLE command_center.imports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),target text NOT NULL CHECK(target IN ('sheets','vault')),
 payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),encrypted_payload bytea NOT NULL CHECK(octet_length(encrypted_payload) BETWEEN 32 AND 6000000),
 total integer NOT NULL CHECK(total BETWEEN 1 AND 500),progress integer NOT NULL DEFAULT 0 CHECK(progress>=0 AND progress<=total),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','approved','applying','uncertain','completed','cancelled')),
 preview jsonb NOT NULL CHECK(octet_length(preview::text)<=200000),receipt jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(receipt::text)<=200000),
 authorization_until timestamptz,claim_key uuid,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,target,payload_hash)
);
CREATE TABLE command_center.import_backups(import_id uuid PRIMARY KEY REFERENCES command_center.imports(id),encrypted_snapshot bytea NOT NULL CHECK(octet_length(encrypted_snapshot) BETWEEN 32 AND 25000000),snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['contact_refs','files','imports','import_backups'] LOOP
 EXECUTE format('ALTER TABLE command_center.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE command_center.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY internal_executor ON command_center.%I TO shadowbridge_workspace_executor USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON command_center.contact_refs,command_center.files,command_center.imports TO shadowbridge_workspace_executor;
GRANT SELECT,INSERT ON command_center.import_backups TO shadowbridge_workspace_executor;
CREATE FUNCTION command_center.file_allowed(kind text,parent text,write_access boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF kind='room' THEN RETURN command_center.room_allowed(parent::uuid,CASE WHEN write_access THEN 'attach' ELSE 'read' END);END IF;
 RETURN kind IN ('contact','page') AND coalesce(sb.is_owner(),false) AND (kind='page' OR EXISTS(SELECT FROM command_center.contact_refs WHERE key=parent));
END $$;
CREATE FUNCTION command_center.files_read(operation text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f command_center.files;BEGIN
 IF operation='list' THEN
  IF NOT command_center.file_allowed(p->>'kind',p->>'parent') THEN RAISE EXCEPTION 'Private files unavailable' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
   SELECT id,filename,mime,pages,created_at AS "createdAt" FROM command_center.files WHERE kind=p->>'kind' AND parent_key=p->>'parent' AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 50) x),'[]'));
 END IF;
 SELECT * INTO f FROM command_center.files WHERE id=(p->>'id')::uuid AND archived_at IS NULL;
 IF NOT FOUND OR NOT command_center.file_allowed(f.kind,f.parent_key) THEN RAISE EXCEPTION 'Private file unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',f.id,'filename',f.filename,'mime',f.mime,'pages',f.pages,'cipher',encode(CASE WHEN operation='preview' THEN f.encrypted_preview ELSE f.encrypted_data END,'hex'));
END $$;
CREATE FUNCTION command_center.files_write(operation text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f command_center.files;target uuid;BEGIN
 IF operation='bind_contact' THEN
  PERFORM command_center.require_owner();
  INSERT INTO command_center.contact_refs(key,source,source_id) VALUES(p->>'key',p->>'source',p->>'sourceId') ON CONFLICT(key) DO UPDATE SET verified_at=now() WHERE command_center.contact_refs.source=excluded.source AND command_center.contact_refs.source_id=excluded.source_id;
  RETURN jsonb_build_object('saved',true);
 ELSIF operation='archive' THEN
  PERFORM command_center.require_owner(true);
  SELECT * INTO f FROM command_center.files WHERE id=(p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT command_center.file_allowed(f.kind,f.parent_key,true) OR (f.kind='page' AND EXISTS(SELECT FROM command_center.pages q JOIN command_center.page_versions v ON v.id=q.published_id WHERE v.blocks @> jsonb_build_array(jsonb_build_object('fileId',f.id::text)))) THEN RAISE EXCEPTION 'File unavailable or published' USING ERRCODE='42501';END IF;
  UPDATE command_center.files SET archived_at=clock_timestamp() WHERE id=f.id;
  PERFORM command_center.record_event('file.archived',f.id::text);RETURN jsonb_build_object('saved',true);
 ELSIF operation='store' THEN
  IF NOT command_center.file_allowed(p->>'kind',p->>'parent',true) OR (p->>'kind'='page' AND p->>'mime'<>'image/png') THEN RAISE EXCEPTION 'Private upload unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO command_center.files(id,kind,parent_key,filename,mime,encrypted_data,encrypted_preview,pages,created_by,request_key)
  VALUES((p->>'id')::uuid,p->>'kind',p->>'parent',p->>'filename',p->>'mime',decode(p->>'cipher','hex'),decode(p->>'previewCipher','hex'),(p->>'pages')::integer,sb.user_id(),(p->>'requestKey')::uuid)
  ON CONFLICT(created_by,request_key) DO NOTHING;
  SELECT id INTO target FROM command_center.files WHERE created_by=sb.user_id() AND request_key=(p->>'requestKey')::uuid;
  IF target IS DISTINCT FROM (p->>'id')::uuid THEN RAISE EXCEPTION 'Upload key changed; keep original receipt' USING ERRCODE='40001';END IF;
  PERFORM command_center.record_event('file.stored',target::text);RETURN jsonb_build_object('id',target,'filename',p->>'filename','mime',p->>'mime');
 END IF;
 RAISE EXCEPTION 'Unknown file operation' USING ERRCODE='22023';
END $$;
CREATE FUNCTION command_center.public_file(target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f command_center.files;BEGIN
 SELECT * INTO f FROM command_center.files WHERE id=target AND kind='page' AND mime='image/png' AND archived_at IS NULL
 AND EXISTS(SELECT FROM command_center.pages q JOIN command_center.page_versions v ON v.id=q.published_id WHERE v.blocks @> jsonb_build_array(jsonb_build_object('fileId',target::text)));
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',f.id,'cipher',encode(f.encrypted_data,'hex'),'mime',f.mime);
END $$;
CREATE FUNCTION command_center.import_read(import_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM command_center.require_owner();
 IF import_id IS NULL THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT id,target,state,total,progress,version,created_at AS "createdAt" FROM command_center.imports WHERE owner_id=sb.user_id() ORDER BY created_at DESC,id LIMIT 50) x),'[]'));END IF;
 RETURN (SELECT (to_jsonb(i)-'encrypted_payload'-'owner_id')||jsonb_build_object('cipher',encode(encrypted_payload,'hex')) FROM command_center.imports i WHERE id=import_id AND owner_id=sb.user_id());
END $$;
CREATE FUNCTION command_center.import_write(operation text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i command_center.imports;target_id uuid;BEGIN
 PERFORM command_center.require_owner(operation='approve');
 IF operation='prepare' THEN
  INSERT INTO command_center.imports(owner_id,target,payload_hash,encrypted_payload,total,preview) VALUES(sb.user_id(),p->>'target',p->>'hash',decode(p->>'cipher','hex'),(p->>'total')::integer,p->'preview') ON CONFLICT(owner_id,target,payload_hash) DO NOTHING;
  SELECT id INTO target_id FROM command_center.imports WHERE owner_id=sb.user_id() AND target=p->>'target' AND payload_hash=p->>'hash';RETURN command_center.import_read(target_id);
 END IF;
 SELECT * INTO i FROM command_center.imports WHERE id=(p->>'id')::uuid AND owner_id=sb.user_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import unavailable' USING ERRCODE='42501';END IF;
 IF operation='approve' THEN
  IF i.state NOT IN ('prepared','approved') OR p->>'hash' IS DISTINCT FROM i.payload_hash THEN RAISE EXCEPTION 'Import changed' USING ERRCODE='40001';END IF;
  UPDATE command_center.imports SET state='approved',authorization_until=clock_timestamp()+interval '2 hours',version=version+1,updated_at=clock_timestamp() WHERE id=i.id;
 ELSIF operation='backup' THEN
  IF i.state<>'approved' THEN RAISE EXCEPTION 'Approve exact import first' USING ERRCODE='42501';END IF;
  INSERT INTO command_center.import_backups(import_id,encrypted_snapshot,snapshot_hash) VALUES(i.id,decode(p->>'cipher','hex'),p->>'hash') ON CONFLICT DO NOTHING;
 ELSIF operation='claim' THEN
  IF i.state<>'approved' OR i.authorization_until IS NULL OR i.authorization_until<=clock_timestamp() OR NOT EXISTS(SELECT FROM command_center.import_backups WHERE import_id=i.id) THEN RAISE EXCEPTION 'Import unapproved, uncertain or backup missing' USING ERRCODE='42501';END IF;
  UPDATE command_center.imports SET state='applying',claim_key=(p->>'claimKey')::uuid,version=version+1,updated_at=clock_timestamp() WHERE id=i.id;
 ELSIF operation IN ('receipt','uncertain') THEN
  IF i.state NOT IN ('applying','uncertain') OR i.claim_key IS DISTINCT FROM (p->>'claimKey')::uuid THEN RAISE EXCEPTION 'Import claim changed' USING ERRCODE='40001';END IF;
  IF operation='uncertain' THEN UPDATE command_center.imports SET state='uncertain',version=version+1,updated_at=clock_timestamp() WHERE id=i.id;
  ELSE
   IF (p->>'progress')::integer< i.progress OR (p->>'progress')::integer>least(i.progress+5,i.total) OR p#>>'{receipt,readbackConfirmed}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Readback receipt required' USING ERRCODE='22023';END IF;
   UPDATE command_center.imports SET progress=(p->>'progress')::integer,state=CASE WHEN (p->>'progress')::integer=total THEN 'completed' ELSE 'approved' END,receipt=receipt||jsonb_build_object(progress::text,p->'receipt'),version=version+1,updated_at=clock_timestamp() WHERE id=i.id;
  END IF;
 ELSIF operation='cancel' THEN
  IF i.state NOT IN ('prepared','approved') THEN RAISE EXCEPTION 'Cannot cancel a potentially written batch' USING ERRCODE='40001';END IF;
  UPDATE command_center.imports SET state='cancelled',version=version+1 WHERE id=i.id;
 ELSE RAISE EXCEPTION 'Unknown import operation' USING ERRCODE='22023';END IF;
 PERFORM command_center.record_event('import.'||operation,i.id::text);RETURN command_center.import_read(i.id);
END $$;
GRANT CREATE ON SCHEMA command_center TO shadowbridge_workspace_executor;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='command_center' AND p.proname IN ('file_allowed','files_read','files_write','public_file','import_read','import_write') LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_workspace_executor',f.signature);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);END LOOP;END $$;
REVOKE CREATE ON SCHEMA command_center FROM shadowbridge_workspace_executor;
GRANT EXECUTE ON FUNCTION command_center.files_read(text,jsonb),command_center.files_write(text,jsonb),command_center.public_file(uuid),command_center.import_read(uuid),command_center.import_write(text,jsonb) TO shadowbridge_api;
COMMIT;
