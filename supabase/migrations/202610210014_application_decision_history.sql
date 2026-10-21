-- Preserve the current application workflow and add an append-only history.
-- Existing records retain their accounts, memberships and current decisions.
BEGIN;

CREATE TABLE sb.application_decisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 application_id uuid NOT NULL REFERENCES sb.applications(id),
 previous_status text CHECK(previous_status IS NULL OR previous_status IN ('pending','approved','rejected')),
 status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 reason text NOT NULL DEFAULT '',
 reviewed_by uuid REFERENCES sb.accounts(user_id),
 reviewed_at timestamptz,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL CHECK(source IN ('decision','legacy_snapshot')),
 CHECK(source='legacy_snapshot' OR length(btrim(reason)) BETWEEN 10 AND 2000),
 CHECK(source<>'legacy_snapshot' OR previous_status IS NULL)
);
ALTER TABLE sb.application_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.application_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sb.application_decisions FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin;
GRANT SELECT ON sb.application_decisions TO shadowbridge_api;
GRANT SELECT,INSERT ON sb.application_decisions TO shadowbridge_policy;
GRANT USAGE,SELECT ON SEQUENCE sb.application_decisions_id_seq TO shadowbridge_policy;

CREATE POLICY application_decision_read ON sb.application_decisions FOR SELECT TO shadowbridge_api
USING (
 sb.has_permission('applications.read') AND sb.has_permission('counterparties.read')
 AND EXISTS(SELECT 1 FROM sb.applications a WHERE a.id=application_decisions.application_id)
);
CREATE INDEX application_decisions_history
 ON sb.application_decisions(application_id,recorded_at DESC,id DESC);
CREATE UNIQUE INDEX application_decisions_legacy_snapshot
 ON sb.application_decisions(application_id) WHERE source='legacy_snapshot';

-- Only the current, documented legacy decision can be recovered. Preserve
-- unknown reviewer/time as NULL; do not fabricate previous decisions or dates.
INSERT INTO sb.application_decisions(application_id,previous_status,status,reason,reviewed_by,reviewed_at,source)
 SELECT id,NULL,status,coalesce(decision_note,''),reviewed_by,reviewed_at,'legacy_snapshot'
 FROM sb.applications WHERE status IN ('approved','rejected');

CREATE FUNCTION sb.capture_application_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous text; history_id bigint;
BEGIN
 IF tg_op='INSERT' THEN
  IF new.status NOT IN ('approved','rejected') THEN RETURN new; END IF;
  previous=NULL;
 ELSE
  IF (new.status,new.decision_note,new.reviewed_by,new.reviewed_at)
    IS NOT DISTINCT FROM (old.status,old.decision_note,old.reviewed_by,old.reviewed_at) THEN RETURN new; END IF;
  -- Capture decisions and an explicit reopening without treating unrelated
  -- changes to a pending application as a management decision.
  IF new.status='pending' AND old.status='pending' THEN RETURN new; END IF;
  previous=old.status;
 END IF;
 INSERT INTO sb.application_decisions(application_id,previous_status,status,reason,reviewed_by,reviewed_at,source)
  VALUES(new.id,previous,new.status,coalesce(new.decision_note,''),new.reviewed_by,new.reviewed_at,'decision')
  RETURNING id INTO history_id;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata)
  VALUES(sb.user_id(),'application.decision_recorded','sb.application_decisions',history_id::text,
   jsonb_build_object('applicationId',new.id,'status',new.status,'previousStatus',previous));
 RETURN new;
END $$;
ALTER FUNCTION sb.capture_application_decision() OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.capture_application_decision() FROM PUBLIC,shadowbridge_api,shadowbridge_sessions,supabase_auth_admin;
CREATE TRIGGER application_decision_history AFTER INSERT OR UPDATE ON sb.applications
 FOR EACH ROW EXECUTE FUNCTION sb.capture_application_decision();
CREATE TRIGGER immutable_application_decisions BEFORE UPDATE OR DELETE ON sb.application_decisions
 FOR EACH ROW EXECUTE FUNCTION sb.prevent_workspace_history_change();

COMMIT;
