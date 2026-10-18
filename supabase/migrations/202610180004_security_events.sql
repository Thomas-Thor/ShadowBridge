BEGIN;
-- An approved, sanitized card is immutable. Publish a fresh reviewed version instead.
REVOKE UPDATE ON portal.opportunities FROM shadowbridge_api;
GRANT UPDATE(status) ON portal.opportunities TO shadowbridge_api;

-- The session service may record only a fixed event vocabulary after Auth proof.
-- It has no business-table access and cannot write arbitrary audit metadata.
CREATE FUNCTION sb.record_auth_event(subject uuid, event text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF event NOT IN ('login','logout','mfa_verified','email_verified','password_changed') OR event IS NULL THEN RAISE EXCEPTION 'Unsupported authentication event' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sb.accounts WHERE user_id=subject) THEN RAISE EXCEPTION 'Authentication subject does not exist' USING ERRCODE='42501'; END IF;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(subject,'auth.'||event,'auth.account',subject::text,'{}');
END $$;
ALTER FUNCTION sb.record_auth_event(uuid,text) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.record_auth_event(uuid,text) FROM PUBLIC,shadowbridge_api;
GRANT EXECUTE ON FUNCTION sb.record_auth_event(uuid,text) TO shadowbridge_sessions;
COMMIT;
