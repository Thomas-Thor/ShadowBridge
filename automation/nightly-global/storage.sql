-- CANDIDATE ONLY. Not in the automatic migration directory. Never apply to
-- Contabo/production without separate OWNER approval. Operational queue/outbox,
-- NOT another CRM. Existing OWNER VAULT, accounts, MFA and agents are untouched.
BEGIN;
DO $$ BEGIN
 IF to_regnamespace('acquisition_ops') IS NOT NULL OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('shadowbridge_acquisition_executor','shadowbridge_acquisition_client')) THEN
  RAISE EXCEPTION 'Acquisition namespace/role collision; review required';
 END IF;
 CREATE ROLE shadowbridge_acquisition_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
 CREATE ROLE shadowbridge_acquisition_client NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
END $$;
CREATE SCHEMA acquisition_ops;
REVOKE ALL ON SCHEMA acquisition_ops FROM PUBLIC;
GRANT USAGE ON SCHEMA acquisition_ops TO shadowbridge_acquisition_executor,shadowbridge_acquisition_client;
CREATE FUNCTION acquisition_ops.clock() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path='' AS $$ SELECT clock_timestamp() $$;
CREATE TABLE acquisition_ops.settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false,target integer NOT NULL DEFAULT 1000 CHECK(target BETWEEN 1000 AND 100000),night_cap integer NOT NULL DEFAULT 5000 CHECK(night_cap BETWEEN 1000 AND 200000),max_parallel integer NOT NULL DEFAULT 3 CHECK(max_parallel BETWEEN 1 AND 10));
INSERT INTO acquisition_ops.settings DEFAULT VALUES;
CREATE TABLE acquisition_ops.bindings(login name PRIMARY KEY,region text NOT NULL CHECK(region IN ('LATAM','ASIA','EUROPE','REPORT')),active boolean NOT NULL DEFAULT false);
CREATE TABLE acquisition_ops.accounts(provider text PRIMARY KEY CHECK(provider IN ('apollo','clay','relevance')),api_access_verified boolean NOT NULL DEFAULT false,daily_request_limit integer NOT NULL DEFAULT 100 CHECK(daily_request_limit BETWEEN 1 AND 10000),daily_credit_limit numeric NOT NULL DEFAULT 0 CHECK(daily_credit_limit>=0),monthly_credit_limit numeric NOT NULL DEFAULT 0 CHECK(monthly_credit_limit>=0),available_credits numeric CHECK(available_credits>=0),verified_at timestamptz);
CREATE TABLE acquisition_ops.sources(key text PRIMARY KEY CHECK(key~'^[a-z0-9_-]{2,80}$'),provider text NOT NULL REFERENCES acquisition_ops.accounts(provider) CHECK(provider IN ('apollo','clay','relevance')),regions text[] NOT NULL,approved boolean NOT NULL DEFAULT false,blocked boolean NOT NULL DEFAULT false,next_allowed_at timestamptz NOT NULL DEFAULT acquisition_ops.clock(),contract_verified boolean NOT NULL DEFAULT false,retention_approved boolean NOT NULL DEFAULT false,config jsonb NOT NULL CHECK(octet_length(config::text)<32768),daily_request_limit integer NOT NULL CHECK(daily_request_limit BETWEEN 1 AND 10000),daily_credit_limit numeric NOT NULL DEFAULT 0 CHECK(daily_credit_limit>=0),max_credits_per_request numeric CHECK(max_credits_per_request>=0),balance_confirmed_at timestamptz,confirmed_available_credits numeric CHECK(confirmed_available_credits>=0),monthly_credit_limit numeric NOT NULL DEFAULT 0 CHECK(monthly_credit_limit>=0));
CREATE TABLE acquisition_ops.jobs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,region text NOT NULL,day date NOT NULL,source_key text NOT NULL REFERENCES acquisition_ops.sources(key),cursor jsonb NOT NULL DEFAULT '{"page":1}',status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','deferred','done','blocked')),lease uuid,lease_until timestamptz,lease_owner name,next_at timestamptz NOT NULL DEFAULT acquisition_ops.clock(),attempts integer NOT NULL DEFAULT 0,started_at timestamptz NOT NULL DEFAULT acquisition_ops.clock(),updated_at timestamptz NOT NULL DEFAULT acquisition_ops.clock(),UNIQUE(region,day,source_key));
CREATE INDEX acquisition_jobs_due ON acquisition_ops.jobs(region,status,next_at);
CREATE TABLE acquisition_ops.calls(id uuid PRIMARY KEY,job_id bigint NOT NULL REFERENCES acquisition_ops.jobs(id),source_key text NOT NULL,provider text NOT NULL,day date NOT NULL,credits_upper_bound numeric NOT NULL,actual_credits numeric,created_at timestamptz NOT NULL DEFAULT acquisition_ops.clock(),status integer,outcome text NOT NULL DEFAULT 'reserved');
CREATE TABLE acquisition_ops.outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text NOT NULL CHECK(type IN ('company','contact','opportunity')),identity_hash text NOT NULL UNIQUE,source_key text NOT NULL REFERENCES acquisition_ops.sources(key),region text NOT NULL,payload jsonb NOT NULL CHECK(octet_length(payload::text)<=16384),created_at timestamptz NOT NULL DEFAULT acquisition_ops.clock(),delivery_state text NOT NULL DEFAULT 'blocked_vault_v3' CHECK(delivery_state IN ('blocked_vault_v3','pending','delivered','review_required')),delivery_receipt uuid,delivered_at timestamptz);
CREATE INDEX acquisition_outbox_day ON acquisition_ops.outbox(created_at,type);
CREATE TABLE acquisition_ops.page_commits(lease uuid PRIMARY KEY,job_id bigint NOT NULL,payload_hash text NOT NULL,added integer NOT NULL,duplicates integer NOT NULL,created_at timestamptz NOT NULL DEFAULT acquisition_ops.clock());
CREATE TABLE acquisition_ops.events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,region text NOT NULL,job_id bigint,kind text NOT NULL,added integer NOT NULL DEFAULT 0,duplicates integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT acquisition_ops.clock());
CREATE TABLE acquisition_ops.reports(day date PRIMARY KEY,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT acquisition_ops.clock());
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['settings','bindings','accounts','sources','jobs','calls','outbox','page_commits','events','reports'] LOOP
  EXECUTE format('ALTER TABLE acquisition_ops.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE acquisition_ops.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY executor_only ON acquisition_ops.%I TO shadowbridge_acquisition_executor USING(true) WITH CHECK(true)',n);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA acquisition_ops FROM PUBLIC,shadowbridge_acquisition_client;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA acquisition_ops TO shadowbridge_acquisition_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA acquisition_ops TO shadowbridge_acquisition_executor;

CREATE FUNCTION acquisition_ops.scope() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text;BEGIN
 IF NOT pg_has_role(session_user,'shadowbridge_acquisition_client','member') THEN RAISE EXCEPTION 'Acquisition principal required' USING ERRCODE='42501';END IF;
 SELECT region INTO r FROM acquisition_ops.bindings WHERE login=session_user AND active;
 IF r IS NULL THEN RAISE EXCEPTION 'Inactive acquisition binding' USING ERRCODE='42501';END IF;RETURN r;
END $$;
CREATE FUNCTION acquisition_ops.claim(requested_region text,at_time timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text:=acquisition_ops.scope();d date;hour_n integer;s acquisition_ops.settings;j acquisition_ops.jobs;src acquisition_ops.sources;account acquisition_ops.accounts;provider_n bigint;provider_daily numeric;provider_monthly numeric;reserved_since_balance numeric;n bigint;daily_used numeric;monthly_used numeric;token uuid;
BEGIN
 IF requested_region<>r OR r='REPORT' THEN RAISE EXCEPTION 'Wrong acquisition region' USING ERRCODE='42501';END IF;
 IF abs(extract(epoch FROM at_time-acquisition_ops.clock()))>60 THEN RAISE EXCEPTION 'Use current server clock';END IF;
 at_time=coalesce(at_time,acquisition_ops.clock());
 d=(at_time AT TIME ZONE 'Europe/Oslo')::date;hour_n=extract(hour FROM at_time AT TIME ZONE 'Europe/Oslo');
 SELECT * INTO s FROM acquisition_ops.settings WHERE id;
 IF NOT s.enabled THEN RETURN '{"fetch":false,"reason":"OWNER_APPROVAL_REQUIRED"}'::jsonb;END IF;
 IF hour_n<(CASE r WHEN 'LATAM' THEN 1 WHEN 'ASIA' THEN 2 ELSE 3 END) OR hour_n>=8 THEN RETURN '{"fetch":false,"reason":"OUTSIDE_NIGHT_WINDOW"}'::jsonb;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('shadowbridge-global-acquisition-claim'));
 IF (SELECT count(*) FROM acquisition_ops.jobs WHERE status='leased' AND lease_until>acquisition_ops.clock())>=s.max_parallel THEN RETURN '{"fetch":false,"reason":"CONCURRENCY_LIMIT"}'::jsonb;END IF;
 IF (SELECT count(*) FROM acquisition_ops.outbox WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=d)>=s.night_cap THEN RETURN '{"fetch":false,"reason":"NIGHT_SAFETY_CAP"}'::jsonb;END IF;
 INSERT INTO acquisition_ops.jobs(region,day,source_key) SELECT r,d,key FROM acquisition_ops.sources WHERE r=ANY(regions) AND approved AND contract_verified AND retention_approved ON CONFLICT DO NOTHING;
 FOR j IN SELECT * FROM acquisition_ops.jobs WHERE region=r AND day>=d-7 AND (status IN ('pending','deferred') AND next_at<=acquisition_ops.clock() OR status='leased' AND lease_until<=acquisition_ops.clock()) ORDER BY day,id FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO src FROM acquisition_ops.sources WHERE key=j.source_key FOR UPDATE;
  IF src.blocked OR src.next_allowed_at>acquisition_ops.clock() OR NOT(src.approved AND src.contract_verified AND src.retention_approved) OR src.max_credits_per_request IS NULL THEN CONTINUE;END IF;
  SELECT count(*),coalesce(sum(credits_upper_bound),0) INTO n,daily_used FROM acquisition_ops.calls WHERE source_key=src.key AND day=d;
  SELECT coalesce(sum(credits_upper_bound),0) INTO monthly_used FROM acquisition_ops.calls WHERE source_key=src.key AND date_trunc('month',day)=date_trunc('month',d);
  IF n>=src.daily_request_limit OR daily_used+src.max_credits_per_request>src.daily_credit_limit OR monthly_used+src.max_credits_per_request>src.monthly_credit_limit THEN CONTINUE;END IF;
  IF src.max_credits_per_request>0 AND (src.balance_confirmed_at IS NULL OR src.balance_confirmed_at<acquisition_ops.clock()-interval '24 hours' OR src.confirmed_available_credits IS NULL OR monthly_used+src.max_credits_per_request>src.confirmed_available_credits) THEN CONTINUE;END IF;
  SELECT * INTO account FROM acquisition_ops.accounts WHERE provider=src.provider FOR UPDATE;
  IF NOT FOUND OR NOT account.api_access_verified THEN CONTINUE;END IF;
  SELECT count(*),coalesce(sum(credits_upper_bound),0) INTO provider_n,provider_daily FROM acquisition_ops.calls WHERE provider=src.provider AND day=d;
  SELECT coalesce(sum(credits_upper_bound),0),coalesce(sum(credits_upper_bound) FILTER(WHERE created_at>=account.verified_at),0) INTO provider_monthly,reserved_since_balance FROM acquisition_ops.calls WHERE provider=src.provider AND date_trunc('month',day)=date_trunc('month',d);
  IF provider_n>=account.daily_request_limit OR provider_daily+src.max_credits_per_request>account.daily_credit_limit OR provider_monthly+src.max_credits_per_request>account.monthly_credit_limit THEN CONTINUE;END IF;
  IF src.max_credits_per_request>0 AND (account.verified_at IS NULL OR account.verified_at<acquisition_ops.clock()-interval '24 hours' OR account.available_credits IS NULL OR reserved_since_balance+src.max_credits_per_request>account.available_credits) THEN CONTINUE;END IF;
  token=gen_random_uuid();
  UPDATE acquisition_ops.jobs SET status='leased',lease=token,lease_owner=session_user,lease_until=acquisition_ops.clock()+interval '120 seconds',attempts=attempts+1,updated_at=acquisition_ops.clock() WHERE id=j.id;
  INSERT INTO acquisition_ops.calls(id,job_id,source_key,provider,day,credits_upper_bound) VALUES(token,j.id,src.key,src.provider,d,src.max_credits_per_request);
  RETURN jsonb_build_object('fetch',true,'id',j.id::text,'lease',token,'region',r,'day',d,'cursor',j.cursor,'source',src.config||jsonb_build_object('key',src.key,'provider',src.provider,'approved',true,'contractVerified',true,'maxCreditsPerRequest',src.max_credits_per_request));
 END LOOP;
 RETURN '{"fetch":false,"reason":"NO_APPROVED_DUE_JOB_OR_BUDGET"}'::jsonb;
END $$;
CREATE FUNCTION acquisition_ops.commit_page(job_id bigint,token uuid,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text:=acquisition_ops.scope();j acquisition_ops.jobs;p acquisition_ops.page_commits;rec jsonb;h text;added_n integer:=0;dupes integer:=0;inserted_n integer;permanent boolean;retry_at timestamptz;d date;s acquisition_ops.settings;digest text;
BEGIN
 IF r='REPORT' THEN RAISE EXCEPTION 'Report cannot ingest' USING ERRCODE='42501';END IF;
 IF result IS NULL OR octet_length(result::text)>2*1024*1024 OR jsonb_typeof(result)<>'object' THEN RAISE EXCEPTION 'Bounded page required';END IF;
 digest=encode(sha256(convert_to(result::text,'UTF8')),'hex');
 SELECT * INTO j FROM acquisition_ops.jobs WHERE id=job_id AND region=r FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No regional job' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM acquisition_ops.page_commits WHERE lease=token;
 IF FOUND THEN IF p.job_id<>j.id OR p.payload_hash<>digest THEN RAISE EXCEPTION 'Changed replay';END IF;RETURN jsonb_build_object('committed',true,'replay',true,'added',p.added,'duplicates',p.duplicates);END IF;
 IF j.status<>'leased' OR j.lease<>token OR j.lease_owner<>session_user OR j.lease_until<=acquisition_ops.clock() THEN RAISE EXCEPTION 'Stale lease' USING ERRCODE='42501';END IF;
 IF (result->>'ok')::boolean IS NOT TRUE THEN
  permanent=coalesce((result->>'permanent')::boolean,false);retry_at=(result->>'retryAt')::timestamptz;
  UPDATE acquisition_ops.jobs SET status=CASE WHEN permanent OR attempts>=8 THEN 'blocked' ELSE 'deferred' END,next_at=greatest(acquisition_ops.clock()+interval '15 minutes',retry_at),lease=NULL,lease_until=NULL,updated_at=acquisition_ops.clock() WHERE id=j.id;
  UPDATE acquisition_ops.sources SET next_allowed_at=greatest(acquisition_ops.clock()+interval '15 minutes',retry_at),blocked=permanent OR j.attempts>=8 WHERE key=j.source_key;
  UPDATE acquisition_ops.calls SET status=coalesce((result->>'status')::integer,0),outcome=CASE WHEN permanent THEN 'blocked' ELSE 'deferred' END WHERE id=token;
  INSERT INTO acquisition_ops.events(region,job_id,kind) VALUES(r,j.id,'source.error');RETURN '{"committed":true,"added":0,"duplicates":0}'::jsonb;
 END IF;
 IF jsonb_typeof(result->'records')<>'array' OR jsonb_array_length(result->'records')>500 THEN RAISE EXCEPTION 'Bounded record array required';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('shadowbridge-global-acquisition-commit'));
 d=(acquisition_ops.clock() AT TIME ZONE 'Europe/Oslo')::date;SELECT * INTO s FROM acquisition_ops.settings WHERE id;
 IF (SELECT count(*) FROM acquisition_ops.outbox WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=d)+jsonb_array_length(result->'records')>s.night_cap THEN RAISE EXCEPTION 'Page exceeds remaining safety capacity; cursor unchanged';END IF;
 FOR rec IN SELECT value FROM jsonb_array_elements(result->'records') LOOP
  IF coalesce(rec->>'type','') NOT IN ('company','contact','opportunity') OR coalesce(length(rec->>'key'),0) NOT BETWEEN 3 AND 1500 OR octet_length(rec::text)>16384 OR coalesce(rec#>>'{company,name}','')='' OR coalesce(rec->>'status','') NOT IN ('unconfirmed','review_required') OR rec->'source' IS NULL THEN RAISE EXCEPTION 'Invalid normalized record';END IF;
  IF rec->>'type'='opportunity' AND (coalesce(rec#>>'{opportunity,kind}','') NOT IN ('BUY','SELL','SURPLUS') OR coalesce(rec#>>'{opportunity,url}','')='') THEN RAISE EXCEPTION 'Evidence required for an opportunity';END IF;
  h=encode(sha256(convert_to((rec->>'type')||':'||(rec->>'key'),'UTF8')),'hex');
  INSERT INTO acquisition_ops.outbox(type,identity_hash,source_key,region,payload) VALUES(rec->>'type',h,j.source_key,r,rec) ON CONFLICT(identity_hash) DO NOTHING;
  GET DIAGNOSTICS inserted_n=ROW_COUNT;added_n=added_n+inserted_n;dupes=dupes+1-inserted_n;
 END LOOP;
 UPDATE acquisition_ops.jobs SET cursor=result->'nextCursor',status=CASE WHEN (result->>'exhausted')::boolean THEN 'done' ELSE 'pending' END,next_at=acquisition_ops.clock()+interval '2 seconds',lease=NULL,lease_until=NULL,attempts=0,updated_at=acquisition_ops.clock() WHERE id=j.id;
 UPDATE acquisition_ops.calls SET status=200,outcome='page.committed' WHERE id=token;
 INSERT INTO acquisition_ops.page_commits(lease,job_id,payload_hash,added,duplicates) VALUES(token,j.id,digest,added_n,dupes);
 INSERT INTO acquisition_ops.events(region,job_id,kind,added,duplicates) VALUES(r,j.id,'page.committed',added_n,dupes);
 RETURN jsonb_build_object('committed',true,'replay',false,'added',added_n,'duplicates',dupes,'crmDelivered',0,'deliveryState','blocked_vault_v3');
END $$;
CREATE FUNCTION acquisition_ops.owner_report(for_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text:=acquisition_ops.scope();report jsonb;BEGIN
 IF r<>'REPORT' THEN RAISE EXCEPTION 'Report-only principal required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('day',for_day,'timezone','Europe/Oslo','target',(SELECT target FROM acquisition_ops.settings WHERE id),'newRecords',count(*),'companies',count(*) FILTER(WHERE type='company'),'contacts',count(*) FILTER(WHERE type='contact'),'BUY',count(*) FILTER(WHERE payload#>>'{opportunity,kind}'='BUY'),'SELL',count(*) FILTER(WHERE payload#>>'{opportunity,kind}'='SELL'),'SURPLUS',count(*) FILTER(WHERE payload#>>'{opportunity,kind}'='SURPLUS'),'crmDelivered',count(*) FILTER(WHERE delivery_state='delivered'),'crmPending',count(*) FILTER(WHERE delivery_state<>'delivered'),'companyGlobalUniquenessReview',count(*) FILTER(WHERE type='company' AND payload->>'globalUniqueness'='source_only')) INTO report FROM acquisition_ops.outbox WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=for_day;
 report=report||jsonb_build_object(
  'countries',(SELECT coalesce(jsonb_object_agg(k,n),'{}'::jsonb) FROM(SELECT coalesce(payload#>>'{company,country}','UNKNOWN') k,count(*) n FROM acquisition_ops.outbox WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=for_day GROUP BY 1)q),
  'categories',(SELECT coalesce(jsonb_object_agg(k,n),'{}'::jsonb) FROM(SELECT coalesce(payload#>>'{company,category}','UNKNOWN') k,count(*) n FROM acquisition_ops.outbox WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=for_day GROUP BY 1)q),
  'regions',(SELECT coalesce(jsonb_object_agg(region,n),'{}'::jsonb) FROM(SELECT region,count(*) n FROM acquisition_ops.outbox WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=for_day GROUP BY 1)q),
  'duplicates',(SELECT coalesce(sum(duplicates),0) FROM acquisition_ops.events WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date=for_day),
  'errors',(SELECT count(*) FROM acquisition_ops.events WHERE kind='source.error' AND (created_at AT TIME ZONE 'Europe/Oslo')::date=for_day),
  'creditsReserved',(SELECT coalesce(sum(credits_upper_bound),0) FROM acquisition_ops.calls WHERE day=for_day),
  'actualCredits',(SELECT CASE WHEN count(*)>0 AND count(*)=count(actual_credits) THEN sum(actual_credits) ELSE NULL END FROM acquisition_ops.calls WHERE day=for_day),
  'elapsedSeconds',(SELECT coalesce(extract(epoch FROM max(updated_at)-min(started_at)),0) FROM acquisition_ops.jobs WHERE day=for_day),
  'blockedSources',(SELECT count(*) FROM acquisition_ops.sources WHERE blocked OR NOT(approved AND contract_verified AND retention_approved) OR max_credits_per_request IS NULL),
  'jobStatuses',(SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb) FROM(SELECT status,count(*) n FROM acquisition_ops.jobs WHERE day=for_day GROUP BY status)q),
  'providerCredits',(SELECT coalesce(jsonb_object_agg(provider,usage),'{}'::jsonb) FROM(SELECT provider,jsonb_build_object('requests',count(*),'upperBoundReserved',sum(credits_upper_bound),'actual',CASE WHEN count(*)=count(actual_credits) THEN sum(actual_credits) ELSE NULL END) usage FROM acquisition_ops.calls WHERE day=for_day GROUP BY provider)q),
  'blockers',jsonb_build_array('VAULT_V3_MACHINE_SINK_NOT_IMPLEMENTED','PROVIDER_BALANCES_REQUIRE_READ_ONLY_CONFIRMATION','EXISTING_FOUR_RELEVANCE_SCOUTS_NOT_INSPECTED'),
  'existingRelevanceScoutSchedulesChanged',false,'automaticEnrichmentExecuted',false);
 INSERT INTO acquisition_ops.reports(day,summary) VALUES(for_day,report) ON CONFLICT(day) DO UPDATE SET summary=excluded.summary,created_at=acquisition_ops.clock();
 RETURN report;
END $$;
DO $$ DECLARE fn regprocedure;BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='acquisition_ops' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_acquisition_executor',fn);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION acquisition_ops.claim(text,timestamptz),acquisition_ops.commit_page(bigint,uuid,jsonb),acquisition_ops.owner_report(date) TO shadowbridge_acquisition_client;
COMMIT;
