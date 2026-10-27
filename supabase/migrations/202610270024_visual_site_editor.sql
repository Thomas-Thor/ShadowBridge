BEGIN;
CREATE TABLE command_center.pages(
 key text PRIMARY KEY CHECK(key IN ('home','member-entry','legal')),version integer NOT NULL DEFAULT 0 CHECK(version>=0),published_id uuid
);
INSERT INTO command_center.pages(key) VALUES('home'),('member-entry'),('legal');
CREATE TABLE command_center.page_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),page text NOT NULL REFERENCES command_center.pages(key),version integer NOT NULL CHECK(version>0),
 blocks jsonb NOT NULL CHECK(jsonb_typeof(blocks)='array' AND jsonb_array_length(blocks)<=30 AND octet_length(blocks::text)<=100000),
 created_by uuid NOT NULL REFERENCES sb.accounts(user_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(page,version)
);
ALTER TABLE command_center.pages ADD CONSTRAINT command_published_version FOREIGN KEY(published_id) REFERENCES command_center.page_versions(id);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['pages','page_versions'] LOOP
 EXECUTE format('ALTER TABLE command_center.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE command_center.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY internal_executor ON command_center.%I TO shadowbridge_workspace_executor USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT SELECT,UPDATE ON command_center.pages TO shadowbridge_workspace_executor;
GRANT SELECT,INSERT ON command_center.page_versions TO shadowbridge_workspace_executor;
CREATE TRIGGER command_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON command_center.page_versions FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history();
CREATE FUNCTION command_center.validate_blocks(blocks jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE b jsonb;BEGIN
 IF blocks IS NULL OR jsonb_typeof(blocks)<>'array' OR jsonb_array_length(blocks)>30 OR octet_length(blocks::text)>100000 THEN RAISE EXCEPTION 'Invalid content blocks' USING ERRCODE='22023';END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(blocks) LOOP
  IF jsonb_typeof(b)<>'object' OR (b->>'type') IS NULL OR b->>'type' NOT IN ('heading','paragraph','image','button','divider')
   OR EXISTS(SELECT FROM jsonb_object_keys(b) k WHERE k NOT IN ('id','type','text','level','href','fileId','alt','align','tone'))
   OR coalesce(b->>'id','') !~ '^[a-zA-Z0-9-]{4,60}$'
   OR length(coalesce(b->>'text',''))>8000 OR length(coalesce(b->>'alt',''))>300
   OR (b ? 'align' AND b->>'align' NOT IN ('left','center','right'))
   OR (b ? 'tone' AND b->>'tone' NOT IN ('default','accent','muted'))
   OR (b->>'type' IN ('heading','paragraph','button') AND length(btrim(coalesce(b->>'text','')))=0)
   OR (b->>'type'='heading' AND coalesce(b->>'level','2') NOT IN ('1','2','3'))
   OR (b->>'type'='image' AND (coalesce(b->>'fileId','') !~ '^[0-9a-f-]{36}$' OR length(btrim(coalesce(b->>'alt','')))=0))
   OR (b->>'type'='button' AND coalesce(b->>'href','') !~ '^/(#|[a-zA-Z0-9/_#-])' )
   OR (b ? 'href' AND (b->>'href' LIKE '//%' OR b->>'href' LIKE '%..%' OR b->>'href'~'[[:cntrl:]\\?]'))
  THEN RAISE EXCEPTION 'Invalid content block' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(blocks))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(blocks)) THEN RAISE EXCEPTION 'Duplicate block ID' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION command_center.site_read(page_key text,public_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p command_center.pages;result jsonb;BEGIN
 IF NOT public_only THEN PERFORM command_center.require_owner();END IF;
 SELECT * INTO p FROM command_center.pages WHERE key=page_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown page' USING ERRCODE='22023';END IF;
 IF public_only THEN
  SELECT jsonb_build_object('page',p.key,'revision',v.id,'blocks',v.blocks) INTO result FROM command_center.page_versions v WHERE id=p.published_id;
  RETURN coalesce(result,jsonb_build_object('page',p.key,'revision',NULL,'blocks',NULL));
 END IF;
 RETURN jsonb_build_object('page',p.key,'version',p.version,'publishedId',p.published_id,'items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT id,version,blocks,created_at AS "createdAt" FROM command_center.page_versions WHERE page=p.key ORDER BY version DESC LIMIT 30) x),'[]'));
END $$;
CREATE FUNCTION command_center.site_write(operation text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE page_row command_center.pages;v command_center.page_versions;BEGIN
 PERFORM command_center.require_owner(operation='publish');
 SELECT * INTO page_row FROM command_center.pages WHERE key=p->>'page' FOR UPDATE;
 IF NOT FOUND OR page_row.version IS DISTINCT FROM (p->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Page changed; reload before saving' USING ERRCODE='40001';END IF;
 IF operation='save' THEN
  PERFORM command_center.validate_blocks(p->'blocks');
  INSERT INTO command_center.page_versions(page,version,blocks,created_by) VALUES(page_row.key,page_row.version+1,p->'blocks',sb.user_id()) RETURNING * INTO v;
  UPDATE command_center.pages SET version=v.version WHERE key=page_row.key;
  PERFORM command_center.record_event('site.draft_saved',v.id::text);
 ELSIF operation='publish' THEN
  SELECT * INTO v FROM command_center.page_versions WHERE id=(p->>'revision')::uuid AND page=page_row.key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version unavailable' USING ERRCODE='22023';END IF;
  PERFORM command_center.validate_blocks(v.blocks);
  UPDATE command_center.pages SET published_id=v.id,version=version+1 WHERE key=page_row.key;
  PERFORM command_center.record_event('site.version_published',v.id::text);
 ELSE RAISE EXCEPTION 'Unknown editor operation' USING ERRCODE='22023';END IF;
 RETURN command_center.site_read(page_row.key,false);
END $$;
GRANT CREATE ON SCHEMA command_center TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.validate_blocks(jsonb) OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.site_read(text,boolean) OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.site_write(text,jsonb) OWNER TO shadowbridge_workspace_executor;
REVOKE CREATE ON SCHEMA command_center FROM shadowbridge_workspace_executor;
REVOKE ALL ON FUNCTION command_center.validate_blocks(jsonb),command_center.site_read(text,boolean),command_center.site_write(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_center.site_read(text,boolean),command_center.site_write(text,jsonb) TO shadowbridge_api;
COMMIT;
