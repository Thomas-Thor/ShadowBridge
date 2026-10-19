-- Internal workspace. No public media store or counterparty release is enabled.
BEGIN;
ALTER TABLE sb.offers DROP CONSTRAINT offers_status_check;
ALTER TABLE sb.offers ADD CONSTRAINT offers_status_check CHECK(status IN ('draft','submitted','clarification_requested','approved','rejected','archived'));
CREATE TABLE sb.offer_workspace (
 offer_id uuid PRIMARY KEY REFERENCES sb.offers(id),
 responsible_user_id uuid REFERENCES sb.accounts(user_id),
 source_kind text NOT NULL DEFAULT 'unreviewed' CHECK(source_kind IN ('unreviewed','supplier_owned','manufacturer_authorized','independent_inspection','marketplace_copy')),
 source_review_note text NOT NULL DEFAULT '' CHECK(length(source_review_note)<=2000),
 source_reviewed_by uuid REFERENCES sb.accounts(user_id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.offer_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 offer_id uuid NOT NULL REFERENCES sb.offers(id), actor_id uuid REFERENCES sb.accounts(user_id),
 action text NOT NULL, old_status text, new_status text, changed_fields text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.offer_decision_notes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, offer_id uuid NOT NULL REFERENCES sb.offers(id),
 actor_id uuid NOT NULL REFERENCES sb.accounts(user_id), decision text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.supplier_qualifications (
 company_id uuid PRIMARY KEY REFERENCES sb.companies(id),
 seller_kind text CHECK(seller_kind IN ('manufacturer','distributor','stock_owner','authorized_seller')),
 stage text NOT NULL DEFAULT 'application' CHECK(stage IN ('application','company','right_to_sell','documents_goods','decision','approved_cooperation')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','rejected','approved')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.supplier_qualification_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, company_id uuid NOT NULL REFERENCES sb.companies(id),
 stage text NOT NULL CHECK(stage IN ('company','right_to_sell','documents_goods','decision')),
 decision text NOT NULL CHECK(decision IN ('verified','rejected')),
 note text NOT NULL CHECK(length(note) BETWEEN 20 AND 2000),
 evidence_reference text NOT NULL CHECK(length(evidence_reference) BETWEEN 6 AND 300),
 actor_id uuid NOT NULL REFERENCES sb.accounts(user_id), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sb.offer_workspace(offer_id) SELECT id FROM sb.offers;
INSERT INTO sb.supplier_qualifications(company_id)
 SELECT DISTINCT company_id FROM sb.memberships WHERE role='supplier';
CREATE INDEX offers_workspace_sort ON sb.offers(updated_at DESC,public_id);
CREATE INDEX offers_workspace_status ON sb.offers(status,created_at DESC,public_id);
CREATE INDEX offer_revision_history ON sb.offer_revisions(offer_id,created_at DESC,id DESC);
CREATE INDEX supplier_review_history ON sb.supplier_qualification_reviews(company_id,created_at DESC,id DESC);

CREATE FUNCTION sb.capture_offer_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE keys text[];
BEGIN
 IF tg_op='INSERT' THEN
  INSERT INTO sb.offer_workspace(offer_id) VALUES(new.id) ON CONFLICT DO NOTHING;
  INSERT INTO sb.supplier_qualifications(company_id) VALUES(new.company_id) ON CONFLICT DO NOTHING;
  SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(new.data) key;
 ELSE
  SELECT array_agg(key ORDER BY key) INTO keys FROM (SELECT key FROM jsonb_object_keys(old.data||new.data) key WHERE old.data->key IS DISTINCT FROM new.data->key) changed;
  IF old.data IS DISTINCT FROM new.data THEN
   UPDATE sb.offer_workspace SET source_kind='unreviewed',source_review_note='',source_reviewed_by=NULL,updated_at=now() WHERE offer_id=new.id;
   UPDATE portal.opportunities SET status='withdrawn' WHERE public_id IN (SELECT public_id FROM sb.opportunity_sources WHERE offer_id=new.id);
  END IF;
 END IF;
 INSERT INTO sb.offer_revisions(offer_id,actor_id,action,old_status,new_status,changed_fields)
 VALUES(new.id,sb.user_id(),lower(tg_op),CASE WHEN tg_op='UPDATE' THEN old.status ELSE NULL END,new.status,coalesce(keys,'{}'));
 RETURN new;
END $$;
CREATE TRIGGER workspace_offer_history AFTER INSERT OR UPDATE ON sb.offers FOR EACH ROW EXECUTE FUNCTION sb.capture_offer_revision();
CREATE FUNCTION sb.prevent_workspace_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'History is append only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER immutable_offer_revisions BEFORE UPDATE OR DELETE ON sb.offer_revisions FOR EACH ROW EXECUTE FUNCTION sb.prevent_workspace_history_change();
CREATE TRIGGER immutable_supplier_reviews BEFORE UPDATE OR DELETE ON sb.supplier_qualification_reviews FOR EACH ROW EXECUTE FUNCTION sb.prevent_workspace_history_change();
CREATE TRIGGER immutable_offer_decisions BEFORE UPDATE OR DELETE ON sb.offer_decision_notes FOR EACH ROW EXECUTE FUNCTION sb.prevent_workspace_history_change();

-- This projection is also the database privacy boundary for staff without source-identity access.
-- Unreviewed free text is never returned to that role, even when it contains company names.
CREATE FUNCTION sb.workspace_offer_dto(o sb.offers) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE fields jsonb='{}'; anonymous jsonb; w sb.offer_workspace; q sb.supplier_qualifications; k text; v jsonb; identity_allowed boolean;
BEGIN
 IF NOT sb.has_permission('offers.read') THEN RAISE EXCEPTION 'Offer permission required' USING ERRCODE='42501'; END IF;
 identity_allowed=sb.has_permission('counterparties.read');
 SELECT * INTO w FROM sb.offer_workspace WHERE offer_id=o.id;
 SELECT * INTO q FROM sb.supplier_qualifications WHERE company_id=o.company_id;
 IF identity_allowed THEN
  FOR k,v IN SELECT key,value FROM jsonb_each(o.data) WHERE key IN ('category','categoryId','subcategoryId','productName','description','specification','countryOfOrigin','quantity','unit','price','currency','minimumOrderQuantity','incoterms','loadingLocation','deliveryTerms','availability','validUntil','certificationsStatus','notes','dimensions','weight','packaging','transport') LOOP
   fields=fields||jsonb_build_object(k,v);
  END LOOP;
 ELSE
  SELECT p.data INTO anonymous FROM portal.opportunities p JOIN sb.opportunity_sources s ON s.public_id=p.public_id WHERE s.offer_id=o.id AND p.status='approved' ORDER BY p.created_at DESC,p.public_id LIMIT 1;
  IF anonymous IS NOT NULL THEN fields=anonymous-'title'||jsonb_build_object('productName',anonymous->>'title');
  ELSE fields=jsonb_build_object('productName','Confidential offer'); END IF;
  FOR k,v IN SELECT key,value FROM jsonb_each(o.data) WHERE key IN ('quantity','price','minimumOrderQuantity','currency','incoterms','unit') LOOP
   IF (k IN ('quantity','price','minimumOrderQuantity') AND jsonb_typeof(v)='number')
     OR (k='currency' AND (v #>> '{}') ~ '^[A-Z]{3}$')
     OR (k='incoterms' AND (v #>> '{}') ~ '^(EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS|FOB|CFR|CIF)$')
     OR (k='unit' AND lower(v #>> '{}') IN ('kg','g','t','tonne','tonnes','mt','m','m2','m3','l','litre','litres','unit','units','piece','pieces','pallet','pallets','container','containers'))
   THEN fields=fields||jsonb_build_object(k,v); END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('id',o.public_id,'status',o.status,'data',fields,'createdAt',o.created_at,'updatedAt',o.updated_at,
  'identityRestricted',NOT identity_allowed,
  'responsible',jsonb_build_object('label',CASE WHEN w.responsible_user_id IS NULL THEN 'Unassigned' WHEN w.responsible_user_id=sb.user_id() THEN 'Assigned to you' ELSE 'ShadowBridge team' END,'isSelf',coalesce(w.responsible_user_id=sb.user_id(),false)),
  'verification',jsonb_build_object('stage',coalesce(q.stage,'application'),'sellerKind',q.seller_kind,'status',coalesce(q.status,'pending'),'sourceKind',coalesce(w.source_kind,'unreviewed')),
  'media',jsonb_build_object('photos','[]'::jsonb,'documents','[]'::jsonb,'uploadEnabled',false));
END $$;
CREATE FUNCTION sb.workspace_offers(search_text text DEFAULT '',state text DEFAULT '',sort_order text DEFAULT 'newest',page_number integer DEFAULT 1,page_size integer DEFAULT 12) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT sb.has_permission('offers.read') THEN RAISE EXCEPTION 'Offer permission required' USING ERRCODE='42501'; END IF;
 IF length(search_text)>100 OR state NOT IN ('','draft','submitted','clarification_requested','approved','rejected','archived') OR sort_order NOT IN ('newest','oldest','updated','price_asc','price_desc') OR page_number<1 OR page_number>100000 OR page_size<1 OR page_size>24 THEN RAISE EXCEPTION 'Invalid workspace filter' USING ERRCODE='22023'; END IF;
 WITH projected AS MATERIALIZED (SELECT o.public_id,o.created_at,o.updated_at,sb.workspace_offer_dto(o) AS entry FROM sb.offers o WHERE state='' OR o.status=state),
 filtered AS MATERIALIZED (SELECT * FROM projected WHERE search_text='' OR strpos(lower(public_id||' '||(entry->'data')::text),lower(search_text))>0),
 ordered AS (SELECT * FROM filtered ORDER BY
  CASE WHEN sort_order='oldest' THEN created_at END ASC,
  CASE WHEN sort_order='newest' THEN created_at END DESC,
  CASE WHEN sort_order='updated' THEN updated_at END DESC,
  CASE WHEN sort_order='price_asc' AND jsonb_typeof(entry->'data'->'price')='number' THEN (entry->'data'->>'price')::numeric END ASC NULLS LAST,
  CASE WHEN sort_order='price_desc' AND jsonb_typeof(entry->'data'->'price')='number' THEN (entry->'data'->>'price')::numeric END DESC NULLS LAST,
  public_id LIMIT page_size OFFSET ((page_number-1)*page_size))
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(entry) FROM ordered),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',page_number,'limit',page_size,'pages',greatest(1,ceil((SELECT count(*) FROM filtered)::numeric/page_size))) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION sb.workspace_offer(public_offer text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o sb.offers; result jsonb; history jsonb; decisions jsonb;
BEGIN
 IF NOT sb.has_permission('offers.read') THEN RAISE EXCEPTION 'Offer permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM sb.offers WHERE public_id=public_offer;
 IF NOT FOUND THEN RETURN NULL; END IF;
 result=sb.workspace_offer_dto(o);
 SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'at',created_at,'actor',CASE WHEN actor_id=sb.user_id() THEN 'You' ELSE 'ShadowBridge team' END,'status',new_status,'changedFields',changed_fields) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM sb.offer_revisions WHERE offer_id=o.id ORDER BY created_at DESC,id DESC LIMIT 50) limited;
 IF sb.has_permission('counterparties.read') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('decision',decision,'reason',reason,'at',created_at,'actor',CASE WHEN actor_id=sb.user_id() THEN 'You' ELSE 'ShadowBridge team' END) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO decisions FROM (SELECT * FROM sb.offer_decision_notes WHERE offer_id=o.id ORDER BY created_at DESC,id DESC LIMIT 50) limited;
 ELSE decisions='[]'::jsonb; END IF;
 RETURN result||jsonb_build_object('history',history,'decisionNotes',decisions);
END $$;

CREATE FUNCTION sb.assign_workspace_offer(public_offer text,responsibility text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE offer_uuid uuid;
BEGIN
 IF NOT sb.has_permission('offers.edit') OR responsibility NOT IN ('me','unassigned') THEN RAISE EXCEPTION 'Offer assignment not permitted' USING ERRCODE='42501'; END IF;
 SELECT id INTO offer_uuid FROM sb.offers WHERE public_id=public_offer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown offer' USING ERRCODE='22023'; END IF;
 INSERT INTO sb.offer_workspace(offer_id,responsible_user_id) VALUES(offer_uuid,CASE WHEN responsibility='me' THEN sb.user_id() ELSE NULL END)
 ON CONFLICT(offer_id) DO UPDATE SET responsible_user_id=excluded.responsible_user_id,updated_at=now();
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(sb.user_id(),'offer_assignment','sb.offer_workspace',public_offer,jsonb_build_object('assignment',responsibility));
 INSERT INTO sb.offer_revisions(offer_id,actor_id,action,new_status,changed_fields) SELECT id,sb.user_id(),'assignment',status,ARRAY['responsible'] FROM sb.offers WHERE id=offer_uuid;
END $$;
CREATE FUNCTION sb.set_workspace_source(public_offer text,source text,review_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE offer_uuid uuid;
BEGIN
 IF NOT sb.has_permission('offers.edit') OR NOT sb.has_permission('supplier_verifications.edit') OR NOT sb.has_permission('counterparties.read') THEN RAISE EXCEPTION 'Source review permission required' USING ERRCODE='42501'; END IF;
 IF source NOT IN ('unreviewed','supplier_owned','manufacturer_authorized','independent_inspection','marketplace_copy') OR length(trim(review_note)) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'Source review and evidence note required' USING ERRCODE='22023'; END IF;
 SELECT id INTO offer_uuid FROM sb.offers WHERE public_id=public_offer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown offer' USING ERRCODE='22023'; END IF;
 INSERT INTO sb.offer_workspace(offer_id,source_kind,source_review_note,source_reviewed_by) VALUES(offer_uuid,source,review_note,sb.user_id()) ON CONFLICT(offer_id) DO UPDATE SET source_kind=excluded.source_kind,source_review_note=excluded.source_review_note,source_reviewed_by=excluded.source_reviewed_by,updated_at=now();
 IF source IN ('unreviewed','marketplace_copy') THEN
  UPDATE sb.offers SET status='submitted' WHERE id=offer_uuid AND status='approved';
  UPDATE portal.opportunities SET status='withdrawn' WHERE public_id IN (SELECT public_id FROM sb.opportunity_sources WHERE offer_id=offer_uuid);
 END IF;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(sb.user_id(),'source_review','sb.offer_workspace',public_offer,jsonb_build_object('sourceKind',source));
 INSERT INTO sb.offer_revisions(offer_id,actor_id,action,new_status,changed_fields) SELECT id,sb.user_id(),'source_review',status,ARRAY['sourceKind'] FROM sb.offers WHERE id=offer_uuid;
END $$;

CREATE FUNCTION sb.edit_workspace_offer(public_offer text,new_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o sb.offers;
BEGIN
 IF NOT sb.has_permission('offers.edit') OR NOT sb.has_permission('counterparties.read') THEN RAISE EXCEPTION 'Offer edit and confidential source permissions required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(new_data)<>'object' OR octet_length(new_data::text)>40000 OR EXISTS(SELECT FROM jsonb_object_keys(new_data) key WHERE key NOT IN ('category','categoryId','subcategoryId','productName','description','specification','countryOfOrigin','quantity','unit','price','currency','minimumOrderQuantity','incoterms','loadingLocation','deliveryTerms','availability','validUntil','certificationsStatus','notes','dimensions','weight','packaging','transport')) THEN RAISE EXCEPTION 'Only commercial offer fields may be edited' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_each(new_data) e WHERE jsonb_typeof(e.value) NOT IN ('string','number','null') OR (jsonb_typeof(e.value)='string' AND length(e.value #>> '{}')>8000)) THEN RAISE EXCEPTION 'Invalid offer field' USING ERRCODE='22023'; END IF;
 SELECT * INTO o FROM sb.offers WHERE public_id=public_offer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown offer' USING ERRCODE='22023'; END IF;
 UPDATE sb.offers SET data=o.data||new_data,status=CASE WHEN o.status='draft' THEN 'draft' ELSE 'submitted' END WHERE id=o.id;
 -- A changed source must be reviewed again; previously released cards are withdrawn.
 UPDATE portal.opportunities SET status='withdrawn' WHERE public_id IN (SELECT public_id FROM sb.opportunity_sources WHERE offer_id=o.id);
END $$;

CREATE FUNCTION sb.decide_workspace_offer(public_offer text,decision text,reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o sb.offers; source text;
BEGIN
 IF decision NOT IN ('approved','rejected','clarification_requested','archived') OR length(trim(reason)) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Offer decision and reason required' USING ERRCODE='22023'; END IF;
 IF NOT sb.has_permission(CASE WHEN decision='approved' THEN 'offers.approve' WHEN decision='rejected' THEN 'offers.reject' WHEN decision='archived' THEN 'offers.archive' ELSE 'offers.edit' END) THEN RAISE EXCEPTION 'Offer decision permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM sb.offers WHERE public_id=public_offer FOR UPDATE;
 IF NOT FOUND OR (o.status='draft' AND decision<>'archived') THEN RAISE EXCEPTION 'Submitted offer required' USING ERRCODE='22023'; END IF;
 IF decision='approved' THEN
  IF NOT EXISTS(SELECT FROM sb.supplier_qualifications WHERE company_id=o.company_id AND status='approved' AND stage='approved_cooperation') THEN RAISE EXCEPTION 'Supplier qualification is required separately from account approval' USING ERRCODE='22023'; END IF;
  SELECT source_kind INTO source FROM sb.offer_workspace WHERE offer_id=o.id;
  IF source IS NULL OR source IN ('unreviewed','marketplace_copy') THEN RAISE EXCEPTION 'Reviewed right to sell this source offer is required' USING ERRCODE='22023'; END IF;
 END IF;
 UPDATE sb.offers SET status=decision WHERE id=o.id;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(sb.user_id(),'workspace_decision','sb.offers',public_offer,jsonb_build_object('status',decision,'reasonRecorded',true));
 -- Reasons are stored in an internal restricted review record, never buyer/supplier messages.
 INSERT INTO sb.offer_decision_notes(offer_id,actor_id,decision,reason) VALUES(o.id,sb.user_id(),decision,reason);
 IF decision<>'approved' THEN UPDATE portal.opportunities SET status='withdrawn' WHERE public_id IN (SELECT public_id FROM sb.opportunity_sources WHERE offer_id=o.id); END IF;
END $$;

CREATE FUNCTION sb.review_supplier_qualification(public_offer text,review_stage text,review_decision text,kind text,review_note text,evidence text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid; q sb.supplier_qualifications; next_stage text;
BEGIN
 IF NOT sb.has_permission('supplier_verifications.edit') OR NOT sb.has_permission('counterparties.read') THEN RAISE EXCEPTION 'Supplier review permission required' USING ERRCODE='42501'; END IF;
 IF review_decision='verified' AND review_stage='decision' AND NOT sb.has_permission('supplier_verifications.approve') THEN RAISE EXCEPTION 'Supplier approval permission required' USING ERRCODE='42501'; END IF;
 IF review_decision='rejected' AND NOT sb.has_permission('supplier_verifications.reject') THEN RAISE EXCEPTION 'Supplier rejection permission required' USING ERRCODE='42501'; END IF;
 IF review_stage NOT IN ('company','right_to_sell','documents_goods','decision') OR review_decision NOT IN ('verified','rejected') OR kind NOT IN ('manufacturer','distributor','stock_owner','authorized_seller') OR length(trim(review_note)) NOT BETWEEN 20 AND 2000 OR length(trim(evidence)) NOT BETWEEN 6 AND 300 THEN RAISE EXCEPTION 'Reviewed evidence, supplier type and decision required' USING ERRCODE='22023'; END IF;
 SELECT company_id INTO company FROM sb.offers WHERE public_id=public_offer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown offer' USING ERRCODE='22023'; END IF;
 INSERT INTO sb.supplier_qualifications(company_id) VALUES(company) ON CONFLICT DO NOTHING;
 SELECT * INTO q FROM sb.supplier_qualifications WHERE company_id=company FOR UPDATE;
 IF NOT (q.stage=review_stage OR (q.stage='application' AND review_stage='company')) THEN RAISE EXCEPTION 'Review stages must be completed in order' USING ERRCODE='22023'; END IF;
 IF q.status='approved' THEN RAISE EXCEPTION 'Approved supplier requires a new compliance review before changing qualification' USING ERRCODE='22023'; END IF;
 next_stage=CASE review_stage WHEN 'company' THEN 'right_to_sell' WHEN 'right_to_sell' THEN 'documents_goods' WHEN 'documents_goods' THEN 'decision' ELSE 'approved_cooperation' END;
 INSERT INTO sb.supplier_qualification_reviews(company_id,stage,decision,note,evidence_reference,actor_id) VALUES(company,review_stage,review_decision,review_note,evidence,sb.user_id());
 UPDATE sb.supplier_qualifications SET seller_kind=kind,stage=CASE WHEN review_decision='rejected' THEN review_stage ELSE next_stage END,status=CASE WHEN review_decision='rejected' THEN 'rejected' WHEN next_stage='approved_cooperation' THEN 'approved' ELSE 'in_review' END,updated_at=now() WHERE company_id=company;
END $$;

CREATE FUNCTION sb.workspace_supplier_qualification(public_offer text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid; result jsonb; reviews jsonb;
BEGIN
 IF NOT sb.has_permission('supplier_verifications.read') OR NOT sb.has_permission('counterparties.read') THEN RAISE EXCEPTION 'Supplier review permission required' USING ERRCODE='42501'; END IF;
 SELECT company_id INTO company FROM sb.offers WHERE public_id=public_offer;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('stage',stage,'status',status,'sellerKind',seller_kind,'updatedAt',updated_at) INTO result FROM sb.supplier_qualifications WHERE company_id=company;
 SELECT coalesce(jsonb_agg(jsonb_build_object('stage',stage,'decision',decision,'note',note,'evidenceReference',evidence_reference,'at',created_at) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO reviews FROM (SELECT * FROM sb.supplier_qualification_reviews WHERE company_id=company ORDER BY created_at DESC,id DESC LIMIT 50) history;
 RETURN coalesce(result,jsonb_build_object('stage','application','status','pending','sellerKind',NULL))||jsonb_build_object('reviews',reviews);
END $$;

CREATE FUNCTION sb.require_qualified_opportunity_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM sb.offers o JOIN sb.supplier_qualifications q ON q.company_id=o.company_id JOIN sb.offer_workspace w ON w.offer_id=o.id WHERE o.id=new.offer_id AND o.status='approved' AND q.status='approved' AND q.stage='approved_cooperation' AND w.source_kind NOT IN ('unreviewed','marketplace_copy')) THEN
  RAISE EXCEPTION 'Qualified supplier and reviewed source offer are required for a new anonymous publication' USING ERRCODE='22023';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER qualified_opportunity_source BEFORE INSERT OR UPDATE ON sb.opportunity_sources FOR EACH ROW EXECUTE FUNCTION sb.require_qualified_opportunity_source();
CREATE FUNCTION sb.require_qualified_offer_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF tg_op='UPDATE' AND old.status='approved' AND new.data IS DISTINCT FROM old.data AND new.status='approved' THEN RAISE EXCEPTION 'Changed commercial data requires a new offer review' USING ERRCODE='22023'; END IF;
 IF new.status='approved' AND (tg_op='INSERT' OR old.status IS DISTINCT FROM 'approved') THEN
  IF NOT EXISTS(SELECT FROM sb.supplier_qualifications q JOIN sb.offer_workspace w ON w.offer_id=new.id WHERE q.company_id=new.company_id AND q.status='approved' AND q.stage='approved_cooperation' AND w.source_kind NOT IN ('unreviewed','marketplace_copy')) THEN RAISE EXCEPTION 'Qualified supplier and reviewed source are required for approval' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER qualified_offer_approval BEFORE INSERT OR UPDATE ON sb.offers FOR EACH ROW EXECUTE FUNCTION sb.require_qualified_offer_approval();

-- Withdrawal is final for this reviewed projection. Publishing a new card requires
-- a fresh source review and explicit grants; changing status cannot bypass that path.
CREATE FUNCTION sb.prevent_opportunity_reactivation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF old.status='withdrawn' AND new.status='approved' THEN RAISE EXCEPTION 'Withdrawn opportunities require a fresh approved publication' USING ERRCODE='22023'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER prevent_opportunity_reactivation BEFORE UPDATE OF status ON portal.opportunities FOR EACH ROW EXECUTE FUNCTION sb.prevent_opportunity_reactivation();
REVOKE ALL ON FUNCTION sb.prevent_opportunity_reactivation() FROM PUBLIC;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['offer_workspace','offer_revisions','offer_decision_notes','supplier_qualifications','supplier_qualification_reviews'] LOOP
  EXECUTE format('ALTER TABLE sb.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sb.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON sb.%I FOR EACH ROW EXECUTE FUNCTION sb.audit_change()',t);
 END LOOP;
END $$;
CREATE POLICY workspace_read ON sb.offer_workspace FOR SELECT TO shadowbridge_api USING(sb.has_permission('offers.read') AND sb.has_permission('counterparties.read'));
CREATE POLICY revision_read ON sb.offer_revisions FOR SELECT TO shadowbridge_api USING(sb.has_permission('offers.read') AND sb.has_permission('counterparties.read'));
CREATE POLICY decision_note_read ON sb.offer_decision_notes FOR SELECT TO shadowbridge_api USING(sb.has_permission('offers.read') AND sb.has_permission('counterparties.read'));
CREATE POLICY qualification_read ON sb.supplier_qualifications FOR SELECT TO shadowbridge_api USING(sb.has_permission('supplier_verifications.read') AND sb.has_permission('counterparties.read'));
CREATE POLICY qualification_review_read ON sb.supplier_qualification_reviews FOR SELECT TO shadowbridge_api USING(sb.has_permission('supplier_verifications.read') AND sb.has_permission('counterparties.read'));
GRANT SELECT ON sb.offer_workspace,sb.offer_revisions,sb.offer_decision_notes,sb.supplier_qualifications,sb.supplier_qualification_reviews TO shadowbridge_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON sb.offer_workspace,sb.offer_revisions,sb.offer_decision_notes,sb.supplier_qualifications,sb.supplier_qualification_reviews TO shadowbridge_policy;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sb TO shadowbridge_policy;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sb' AND p.proname IN ('capture_offer_revision','workspace_offer_dto','workspace_offers','workspace_offer','assign_workspace_offer','set_workspace_source','edit_workspace_offer','decide_workspace_offer','review_supplier_qualification','workspace_supplier_qualification','require_qualified_opportunity_source','require_qualified_offer_approval') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_policy',f);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION sb.prevent_workspace_history_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sb.workspace_offers(text,text,text,integer,integer),sb.workspace_offer(text),sb.assign_workspace_offer(text,text),sb.set_workspace_source(text,text,text),sb.edit_workspace_offer(text,jsonb),sb.decide_workspace_offer(text,text,text),sb.review_supplier_qualification(text,text,text,text,text,text),sb.workspace_supplier_qualification(text) TO shadowbridge_api;
COMMIT;
