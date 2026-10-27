BEGIN;
CREATE ROLE shadowbridge_briefing_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE TABLE command_center.source_observations(
 source text PRIMARY KEY CHECK(source IN ('n8n','clay','apollo','backups','application')),status text NOT NULL CHECK(status IN ('ok','warning','error')),
 observed_at timestamptz NOT NULL,metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='object' AND octet_length(metrics::text)<=4000)
);
CREATE TABLE command_center.briefings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES sb.accounts(user_id),window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=50000),created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,UNIQUE(owner_id,window_end)
);
CREATE INDEX command_briefing_page ON command_center.briefings(owner_id,window_end DESC);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['source_observations','briefings'] LOOP
 EXECUTE format('ALTER TABLE command_center.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE command_center.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY internal_executor ON command_center.%I TO shadowbridge_workspace_executor USING(true) WITH CHECK(true)',t);
 EXECUTE format('CREATE POLICY report_executor ON command_center.%I TO shadowbridge_briefing_executor USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON command_center.source_observations,command_center.briefings TO shadowbridge_workspace_executor;
GRANT USAGE ON SCHEMA command_center,sb,owner_vault,owner_book TO shadowbridge_briefing_executor;
GRANT SELECT,INSERT ON command_center.briefings TO shadowbridge_briefing_executor;
GRANT SELECT ON command_center.source_observations TO shadowbridge_briefing_executor;
GRANT SELECT(created_at) ON owner_vault.companies,owner_vault.contacts TO shadowbridge_briefing_executor;
GRANT SELECT(created_at,status) ON owner_vault.intakes TO shadowbridge_briefing_executor;
GRANT SELECT(id,owner_id,kind,title,status,due_at,archived) ON owner_book.entries TO shadowbridge_briefing_executor;
GRANT SELECT(user_id,role_key,active) ON sb.staff_role_assignments TO shadowbridge_briefing_executor;
GRANT EXECUTE ON FUNCTION sb.book_owner_active(uuid) TO shadowbridge_briefing_executor;
CREATE POLICY briefing_counts ON owner_vault.companies FOR SELECT TO shadowbridge_briefing_executor USING(true);
CREATE POLICY briefing_counts ON owner_vault.contacts FOR SELECT TO shadowbridge_briefing_executor USING(true);
CREATE POLICY briefing_counts ON owner_vault.intakes FOR SELECT TO shadowbridge_briefing_executor USING(true);
CREATE POLICY briefing_tasks ON owner_book.entries FOR SELECT TO shadowbridge_briefing_executor USING(true);
CREATE POLICY briefing_owners ON sb.staff_role_assignments FOR SELECT TO shadowbridge_briefing_executor USING(true);
CREATE FUNCTION command_center.refresh_briefings() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE local_now timestamp;finish timestamptz;begin_at timestamptz;subject uuid;data jsonb;n integer:=0;changed integer;BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('shadowbridge-morning-briefing-v1',0)) THEN RETURN 0;END IF;
 local_now=clock_timestamp() AT TIME ZONE 'Europe/Oslo';
 finish=(local_now::date+time '08:00') AT TIME ZONE 'Europe/Oslo';
 IF finish>clock_timestamp() THEN finish=((local_now::date-1)+time '08:00') AT TIME ZONE 'Europe/Oslo';END IF;
 begin_at=(((finish AT TIME ZONE 'Europe/Oslo')::date-1)+time '18:00') AT TIME ZONE 'Europe/Oslo';
 FOR subject IN SELECT user_id FROM sb.staff_role_assignments WHERE role_key='owner' AND active AND sb.book_owner_active(user_id) LOOP
  IF EXISTS(SELECT FROM command_center.briefings WHERE owner_id=subject AND window_end=finish) THEN CONTINUE;END IF;
  SELECT jsonb_build_object(
   'timezone','Europe/Oslo','start',begin_at,'end',finish,'generatedAt',clock_timestamp(),
   'vault',jsonb_build_object('companies',(SELECT count(*) FROM owner_vault.companies WHERE created_at>=begin_at AND created_at<finish),
    'contacts',(SELECT count(*) FROM owner_vault.contacts WHERE created_at>=begin_at AND created_at<finish),
    'duplicates',(SELECT count(*) FROM owner_vault.intakes WHERE created_at>=begin_at AND created_at<finish AND status='duplicate_prevented'),
    'reviews',(SELECT count(*) FROM owner_vault.intakes WHERE created_at>=begin_at AND created_at<finish AND status='review_required')),
   'tasks',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,title,due_at AS "dueAt",status FROM owner_book.entries WHERE owner_id=subject AND NOT archived AND kind='task' AND status NOT IN ('done','cancelled') AND due_at<=finish+interval '24 hours' ORDER BY due_at,id LIMIT 20) x),'[]'),
   'sources',(SELECT jsonb_agg(jsonb_build_object('source',k,'status',CASE WHEN o.observed_at IS NULL THEN 'NO_DATA' WHEN o.observed_at<clock_timestamp()-interval '1 hour' THEN 'STALE' ELSE upper(o.status) END,'observedAt',o.observed_at,'metrics',o.metrics)) FROM unnest(ARRAY['n8n','clay','apollo','backups','application']) k LEFT JOIN command_center.source_observations o ON o.source=k),
   'delivery','command_center','externalDelivery',false,'aiUsed',false) INTO data;
  INSERT INTO command_center.briefings(owner_id,window_start,window_end,payload) VALUES(subject,begin_at,finish,data) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS changed=ROW_COUNT;n=n+changed;
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION command_center.briefing_read() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM command_center.require_owner();
 RETURN jsonb_build_object('unread',(SELECT count(*) FROM command_center.briefings WHERE owner_id=sb.user_id() AND read_at IS NULL),
 'items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,payload,created_at AS "createdAt",read_at AS "readAt" FROM command_center.briefings WHERE owner_id=sb.user_id() ORDER BY window_end DESC LIMIT 30) x),'[]'));
END $$;
CREATE FUNCTION command_center.briefing_mark_read(target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM command_center.require_owner();UPDATE command_center.briefings SET read_at=coalesce(read_at,clock_timestamp()) WHERE id=target AND owner_id=sb.user_id();END $$;
CREATE FUNCTION command_center.observe_source(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM command_center.require_owner();
 IF (p->>'observedAt')::timestamptz>clock_timestamp()+interval '30 seconds' OR (p->>'observedAt')::timestamptz<clock_timestamp()-interval '24 hours'
 OR EXISTS(SELECT FROM jsonb_each(p->'metrics') x WHERE jsonb_typeof(x.value) NOT IN ('number','boolean','null') OR x.key !~ '^[a-zA-Z][a-zA-Z0-9_]{0,49}$') THEN RAISE EXCEPTION 'Invalid source observation' USING ERRCODE='22023';END IF;
 INSERT INTO command_center.source_observations VALUES(p->>'source',p->>'status',(p->>'observedAt')::timestamptz,p->'metrics')
 ON CONFLICT(source) DO UPDATE SET status=excluded.status,observed_at=excluded.observed_at,metrics=excluded.metrics WHERE command_center.source_observations.observed_at<=excluded.observed_at;
END $$;
GRANT CREATE ON SCHEMA command_center TO shadowbridge_briefing_executor,shadowbridge_workspace_executor;
ALTER FUNCTION command_center.refresh_briefings() OWNER TO shadowbridge_briefing_executor;
ALTER FUNCTION command_center.briefing_read() OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.briefing_mark_read(uuid) OWNER TO shadowbridge_workspace_executor;
ALTER FUNCTION command_center.observe_source(jsonb) OWNER TO shadowbridge_workspace_executor;
REVOKE CREATE ON SCHEMA command_center FROM shadowbridge_briefing_executor,shadowbridge_workspace_executor;
REVOKE ALL ON FUNCTION command_center.refresh_briefings(),command_center.briefing_read(),command_center.briefing_mark_read(uuid),command_center.observe_source(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_center.refresh_briefings() TO shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION command_center.briefing_read(),command_center.briefing_mark_read(uuid),command_center.observe_source(jsonb) TO shadowbridge_api;
COMMIT;
