-- Additive Command Center R2. No backfill and no new login/OWNER grants.
BEGIN;
CREATE ROLE shadowbridge_workspace_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA command_center;
REVOKE ALL ON SCHEMA command_center FROM PUBLIC;
GRANT USAGE ON SCHEMA command_center TO shadowbridge_api,shadowbridge_sessions,shadowbridge_workspace_executor;
GRANT USAGE ON SCHEMA sb TO shadowbridge_workspace_executor;
GRANT EXECUTE ON FUNCTION sb.user_id(),sb.is_owner(),sb.is_staff(),sb.has_permission(text),sb.require_fresh_owner_mfa() TO shadowbridge_workspace_executor;
CREATE TABLE command_center.events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid,action text NOT NULL CHECK(action~'^[a-z_.]+$'),
 resource_id text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX command_events_page ON command_center.events(created_at DESC,id DESC);
CREATE TRIGGER command_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON command_center.events FOR EACH STATEMENT EXECUTE FUNCTION owner_vault.immutable_history();
ALTER TABLE command_center.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_center.events FORCE ROW LEVEL SECURITY;
CREATE POLICY internal_executor ON command_center.events TO shadowbridge_workspace_executor USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON command_center.events TO shadowbridge_workspace_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA command_center TO shadowbridge_workspace_executor;
CREATE FUNCTION command_center.require_owner(fresh boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT coalesce(sb.is_owner(),false) THEN RAISE EXCEPTION 'OWNER and MFA required' USING ERRCODE='42501'; END IF;
 IF fresh THEN PERFORM sb.require_fresh_owner_mfa(); END IF;
END $$;
CREATE FUNCTION command_center.record_event(action text,resource text DEFAULT '') RETURNS void LANGUAGE sql SET search_path='' AS $$
 INSERT INTO command_center.events(actor_id,action,resource_id) VALUES(sb.user_id(),action,resource)
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA command_center FROM PUBLIC;
GRANT CREATE ON SCHEMA command_center TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.require_owner(boolean) OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.record_event(text,text) OWNER TO shadowbridge_workspace_executor;
REVOKE CREATE ON SCHEMA command_center FROM shadowbridge_workspace_executor;
COMMIT;
