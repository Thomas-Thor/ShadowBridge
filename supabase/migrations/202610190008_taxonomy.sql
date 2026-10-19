-- Central controlled classification. Existing ambiguous labels are preserved
-- verbatim and marked for human review; no guessed matches or source IDs leak.
BEGIN;
CREATE TABLE sb.categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE CHECK(key ~ '^[a-z][a-z0-9-]{1,79}$'),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 2 AND 100), parent_id uuid REFERENCES sb.categories(id),
 active boolean NOT NULL DEFAULT true, technical boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(id IS DISTINCT FROM parent_id)
);
INSERT INTO sb.categories(id,key,label,parent_id,active,technical,position) VALUES
('10000000-0000-4000-8000-000000000000','unclassified','Unclassified — manual review',NULL,false,true,0),
('10000000-0000-4000-8000-000000000001','food-agriculture','Food & agriculture',NULL,true,false,10),
('10000000-0000-4000-8000-000000000101','fresh-produce','Fresh produce','10000000-0000-4000-8000-000000000001',true,false,10),
('10000000-0000-4000-8000-000000000102','grains-ingredients','Grains & ingredients','10000000-0000-4000-8000-000000000001',true,false,20),
('10000000-0000-4000-8000-000000000103','processed-food','Processed food','10000000-0000-4000-8000-000000000001',true,false,30),
('10000000-0000-4000-8000-000000000002','water-beverages','Water & beverages',NULL,true,false,20),
('10000000-0000-4000-8000-000000000201','drinking-water','Drinking water','10000000-0000-4000-8000-000000000002',true,false,10),
('10000000-0000-4000-8000-000000000202','non-alcoholic-beverages','Non-alcoholic beverages','10000000-0000-4000-8000-000000000002',true,false,20),
('10000000-0000-4000-8000-000000000203','water-treatment','Water treatment','10000000-0000-4000-8000-000000000002',true,false,30),
('10000000-0000-4000-8000-000000000003','machinery-equipment','Machinery & equipment',NULL,true,false,30),
('10000000-0000-4000-8000-000000000301','industrial-machinery','Industrial machinery','10000000-0000-4000-8000-000000000003',true,false,10),
('10000000-0000-4000-8000-000000000302','agricultural-equipment','Agricultural equipment','10000000-0000-4000-8000-000000000003',true,false,20),
('10000000-0000-4000-8000-000000000303','spare-parts','Spare parts','10000000-0000-4000-8000-000000000003',true,false,30),
('10000000-0000-4000-8000-000000000004','industrial-supplies','Industrial supplies',NULL,true,false,40),
('10000000-0000-4000-8000-000000000401','raw-materials','Raw materials','10000000-0000-4000-8000-000000000004',true,false,10),
('10000000-0000-4000-8000-000000000402','industrial-consumables','Industrial consumables','10000000-0000-4000-8000-000000000004',true,false,20),
('10000000-0000-4000-8000-000000000403','safety-equipment','Safety equipment','10000000-0000-4000-8000-000000000004',true,false,30),
('10000000-0000-4000-8000-000000000005','hotel-hospitality','Hotel & hospitality',NULL,true,false,50),
('10000000-0000-4000-8000-000000000501','hotel-equipment','Hotel equipment','10000000-0000-4000-8000-000000000005',true,false,10),
('10000000-0000-4000-8000-000000000502','furniture-fittings','Furniture & fittings','10000000-0000-4000-8000-000000000005',true,false,20),
('10000000-0000-4000-8000-000000000503','hospitality-consumables','Hospitality consumables','10000000-0000-4000-8000-000000000005',true,false,30),
('10000000-0000-4000-8000-000000000006','energy-infrastructure','Energy & infrastructure',NULL,true,false,60),
('10000000-0000-4000-8000-000000000601','energy-equipment','Energy equipment','10000000-0000-4000-8000-000000000006',true,false,10),
('10000000-0000-4000-8000-000000000602','renewables','Renewable energy','10000000-0000-4000-8000-000000000006',true,false,20),
('10000000-0000-4000-8000-000000000603','construction-infrastructure','Construction & infrastructure','10000000-0000-4000-8000-000000000006',true,false,30),
('10000000-0000-4000-8000-000000000007','emergency-humanitarian','Emergency & humanitarian supplies',NULL,true,false,70),
('10000000-0000-4000-8000-000000000701','emergency-food-water','Emergency food & water','10000000-0000-4000-8000-000000000007',true,false,10),
('10000000-0000-4000-8000-000000000702','humanitarian-equipment','Humanitarian equipment','10000000-0000-4000-8000-000000000007',true,false,20),
('10000000-0000-4000-8000-000000000703','shelter-relief','Shelter & relief supplies','10000000-0000-4000-8000-000000000007',true,false,30),
('10000000-0000-4000-8000-000000000008','other-opportunities','Other opportunities',NULL,true,false,80),
('10000000-0000-4000-8000-000000000801','surplus-stock','Surplus stock','10000000-0000-4000-8000-000000000008',true,false,10),
('10000000-0000-4000-8000-000000000802','special-projects','Special projects','10000000-0000-4000-8000-000000000008',true,false,20),
('10000000-0000-4000-8000-000000000803','other-goods-services','Other goods & services','10000000-0000-4000-8000-000000000008',true,false,30);
CREATE TABLE sb.currencies (code text PRIMARY KEY CHECK(code ~ '^[A-Z]{3}$'),label text NOT NULL,active boolean NOT NULL DEFAULT true,position integer NOT NULL);
INSERT INTO sb.currencies(code,label,position) VALUES ('EUR','EUR — Euro',10),('USD','USD — US dollar',20),('GBP','GBP — Pound sterling',30),('NOK','NOK — Norwegian krone',40),('PLN','PLN — Polish złoty',50);
INSERT INTO sb.staff_permissions(key) VALUES ('taxonomy.read'),('taxonomy.create'),('taxonomy.edit');
INSERT INTO sb.staff_role_permissions(role_key,permission)
 SELECT r,p.key FROM unnest(ARRAY['owner','general_director','procurement_manager','sales_manager']) r CROSS JOIN sb.staff_permissions p WHERE p.key IN ('taxonomy.read','taxonomy.create','taxonomy.edit');
INSERT INTO sb.staff_role_permissions(role_key,permission)
 SELECT r,'taxonomy.read' FROM unnest(ARRAY['operations_manager','compliance_finance']) r;

-- A technical valid FK for legacy records is deliberately not a public category.
-- Adding constant defaults leaves all original data, IDs and timestamps intact.
ALTER TABLE sb.offers ADD COLUMN category_id uuid NOT NULL DEFAULT '10000000-0000-4000-8000-000000000000' REFERENCES sb.categories(id),ADD COLUMN subcategory_id uuid REFERENCES sb.categories(id),ADD COLUMN classification_review_required boolean NOT NULL DEFAULT true;
ALTER TABLE sb.rfqs ADD COLUMN category_id uuid NOT NULL DEFAULT '10000000-0000-4000-8000-000000000000' REFERENCES sb.categories(id),ADD COLUMN subcategory_id uuid REFERENCES sb.categories(id),ADD COLUMN classification_review_required boolean NOT NULL DEFAULT true;
ALTER TABLE portal.opportunities ADD COLUMN category_id uuid NOT NULL DEFAULT '10000000-0000-4000-8000-000000000000' REFERENCES sb.categories(id),ADD COLUMN subcategory_id uuid REFERENCES sb.categories(id),ADD COLUMN classification_review_required boolean NOT NULL DEFAULT true;
-- Migration-only backfill changes normalized columns, never legacy free text or
-- commercial status. Temporarily suspend only application-action guards inside
-- this atomic schema transaction; normal runtime roles cannot do this.
ALTER TABLE sb.offers DISABLE TRIGGER offer_update;
ALTER TABLE sb.rfqs DISABLE TRIGGER rfq_update;
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['sb.offers','sb.rfqs','portal.opportunities'] LOOP
  EXECUTE format('UPDATE %s o SET category_id=coalesce(c.parent_id,c.id),subcategory_id=CASE WHEN c.parent_id IS NOT NULL THEN c.id END,classification_review_required=false FROM sb.categories c WHERE NOT c.technical AND o.data->>''category''=c.label',target);
 END LOOP;
END $$;
ALTER TABLE sb.offers ENABLE TRIGGER offer_update;
ALTER TABLE sb.rfqs ENABLE TRIGGER rfq_update;
ALTER TABLE sb.offers ALTER COLUMN category_id DROP DEFAULT,ALTER COLUMN classification_review_required SET DEFAULT false;
ALTER TABLE sb.rfqs ALTER COLUMN category_id DROP DEFAULT,ALTER COLUMN classification_review_required SET DEFAULT false;
ALTER TABLE portal.opportunities ALTER COLUMN category_id DROP DEFAULT,ALTER COLUMN classification_review_required SET DEFAULT false;
CREATE INDEX offers_category_page ON sb.offers(category_id,subcategory_id,created_at DESC,public_id);
CREATE INDEX rfqs_category_page ON sb.rfqs(category_id,subcategory_id,created_at DESC,public_id);
CREATE INDEX opportunities_category_page ON portal.opportunities(category_id,subcategory_id,created_at DESC,public_id);

CREATE FUNCTION sb.catalog(include_inactive boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF include_inactive AND NOT sb.has_permission('taxonomy.read') THEN RAISE EXCEPTION 'Classification permission required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('categories',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'key',c.key,'label',c.label,'parentId',c.parent_id,'active',c.active,'position',c.position) ORDER BY c.position,c.label,c.id) FROM sb.categories c WHERE NOT c.technical AND (include_inactive OR (c.active AND (c.parent_id IS NULL OR EXISTS(SELECT FROM sb.categories p WHERE p.id=c.parent_id AND p.active))))),'[]'::jsonb),'currencies',coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY position,code) FROM sb.currencies WHERE active),'[]'::jsonb));
END $$;
CREATE FUNCTION sb.guard_category_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF tg_op='UPDATE' AND (new.id<>old.id OR new.key<>old.key OR new.parent_id IS DISTINCT FROM old.parent_id OR new.technical IS DISTINCT FROM old.technical OR new.created_at<>old.created_at) THEN RAISE EXCEPTION 'Classification identity and parent are immutable; create a new classification instead' USING ERRCODE='22023'; END IF;
 IF new.technical THEN RAISE EXCEPTION 'Technical category is reserved for migration review' USING ERRCODE='42501'; END IF;
 IF new.parent_id IS NOT NULL AND NOT EXISTS(SELECT FROM sb.categories WHERE id=new.parent_id AND parent_id IS NULL AND NOT technical AND (active OR NOT new.active)) THEN RAISE EXCEPTION 'Choose an active root category as parent' USING ERRCODE='22023'; END IF;
 IF NOT new.active AND EXISTS(SELECT FROM sb.categories WHERE parent_id=new.id AND active) THEN RAISE EXCEPTION 'Deactivate subcategories before their parent' USING ERRCODE='22023'; END IF;
 new.updated_at=now();RETURN new;
END $$;
CREATE TRIGGER category_guard BEFORE INSERT OR UPDATE ON sb.categories FOR EACH ROW EXECUTE FUNCTION sb.guard_category_change();
CREATE FUNCTION sb.create_category(new_key text,new_label text,parent uuid DEFAULT NULL,enabled boolean DEFAULT true,sort_position integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item sb.categories;
BEGIN
 IF NOT sb.has_permission('taxonomy.create') THEN RAISE EXCEPTION 'Classification creation permission required' USING ERRCODE='42501'; END IF;
 IF new_key IS NULL OR new_key !~ '^[a-z][a-z0-9-]{1,79}$' OR new_label IS NULL OR length(trim(new_label)) NOT BETWEEN 2 AND 100 OR enabled IS NULL OR sort_position IS NULL OR sort_position NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Valid classification fields required' USING ERRCODE='22023'; END IF;
 INSERT INTO sb.categories(key,label,parent_id,active,position) VALUES(new_key,trim(new_label),parent,enabled,sort_position) RETURNING * INTO item;
 RETURN jsonb_build_object('id',item.id,'key',item.key,'label',item.label,'parentId',item.parent_id,'active',item.active,'position',item.position);
END $$;
CREATE FUNCTION sb.update_category(target uuid,changes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item sb.categories;
BEGIN
 IF NOT sb.has_permission('taxonomy.edit') THEN RAISE EXCEPTION 'Classification edit permission required' USING ERRCODE='42501'; END IF;
 IF changes IS NULL OR jsonb_typeof(changes)<>'object' OR changes='{}'::jsonb OR EXISTS(SELECT FROM jsonb_object_keys(changes) k WHERE k NOT IN ('label','active','position')) OR
 (changes?'label' AND (jsonb_typeof(changes->'label')<>'string' OR length(trim(changes->>'label')) NOT BETWEEN 2 AND 100)) OR
 (changes?'active' AND jsonb_typeof(changes->'active')<>'boolean') OR
 (changes?'position' AND (jsonb_typeof(changes->'position')<>'number' OR (changes->>'position') !~ '^[0-9]{1,5}$' OR (changes->>'position')::integer NOT BETWEEN 0 AND 10000)) THEN RAISE EXCEPTION 'Invalid classification changes' USING ERRCODE='22023'; END IF;
 UPDATE sb.categories SET label=CASE WHEN changes?'label' THEN trim(changes->>'label') ELSE label END,active=CASE WHEN changes?'active' THEN (changes->>'active')::boolean ELSE active END,position=CASE WHEN changes?'position' THEN (changes->>'position')::integer ELSE position END WHERE id=target AND NOT technical RETURNING * INTO item;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown classification' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('id',item.id,'key',item.key,'label',item.label,'parentId',item.parent_id,'active',item.active,'position',item.position);
END $$;

CREATE FUNCTION sb.enforce_record_classification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE root_category sb.categories; sub_category sb.categories; selected uuid; selected_sub uuid; changed boolean;
BEGIN
 changed=tg_op='INSERT';
 IF tg_op='UPDATE' THEN changed=new.data IS DISTINCT FROM old.data; END IF;
 IF changed THEN
  IF NOT (new.data?'categoryId') OR coalesce(new.data->>'categoryId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'A valid controlled category is required' USING ERRCODE='22023'; END IF;
  selected=(new.data->>'categoryId')::uuid;
  IF new.data?'subcategoryId' AND new.data->'subcategoryId'<>'null'::jsonb AND coalesce(new.data->>'subcategoryId','')<>'' THEN
   IF new.data->>'subcategoryId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid subcategory' USING ERRCODE='22023'; END IF;
   selected_sub=(new.data->>'subcategoryId')::uuid;
  END IF;
  SELECT * INTO root_category FROM sb.categories WHERE id=selected;
  IF NOT FOUND OR root_category.parent_id IS NOT NULL OR root_category.technical OR NOT root_category.active THEN RAISE EXCEPTION 'Choose an active root category' USING ERRCODE='22023'; END IF;
  IF selected_sub IS NOT NULL THEN
   SELECT * INTO sub_category FROM sb.categories WHERE id=selected_sub;
   IF NOT FOUND OR sub_category.parent_id IS DISTINCT FROM selected OR sub_category.technical OR NOT sub_category.active THEN RAISE EXCEPTION 'Subcategory must belong to the selected category' USING ERRCODE='22023'; END IF;
  END IF;
  new.category_id=selected;new.subcategory_id=selected_sub;new.classification_review_required=false;
  -- Canonical display labels are server derived; caller free text never defines taxonomy.
  new.data=(new.data-'category'-'subcategory')||jsonb_build_object('category',root_category.label);
  IF selected_sub IS NOT NULL THEN new.data=new.data||jsonb_build_object('subcategory',sub_category.label); END IF;
 ELSE
  -- Runtime callers cannot bypass the catalogue by writing normalized columns.
  new.category_id=old.category_id;new.subcategory_id=old.subcategory_id;new.classification_review_required=old.classification_review_required;
 END IF;
 IF new.classification_review_required AND ((tg_op='INSERT') OR (tg_op='UPDATE' AND new.status IS DISTINCT FROM old.status AND new.status IN ('submitted','approved','accepted','in_review'))) THEN RAISE EXCEPTION 'Legacy classification requires manual review before submission or approval' USING ERRCODE='22023'; END IF;
 IF changed AND new.data?'currency' AND coalesce(new.data->>'currency','')<>'' AND NOT EXISTS(SELECT FROM sb.currencies WHERE code=new.data->>'currency' AND active) THEN RAISE EXCEPTION 'Choose a supported ISO 4217 source currency' USING ERRCODE='22023'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER z_classification_guard BEFORE INSERT OR UPDATE ON sb.offers FOR EACH ROW EXECUTE FUNCTION sb.enforce_record_classification();
CREATE TRIGGER z_classification_guard BEFORE INSERT OR UPDATE ON sb.rfqs FOR EACH ROW EXECUTE FUNCTION sb.enforce_record_classification();
CREATE TRIGGER z_classification_guard BEFORE INSERT OR UPDATE ON portal.opportunities FOR EACH ROW EXECUTE FUNCTION sb.enforce_record_classification();

-- Keep the existing private projection and add only public classification data.
ALTER FUNCTION sb.workspace_offer_dto(sb.offers) RENAME TO workspace_offer_dto_without_taxonomy;
CREATE FUNCTION sb.workspace_offer_dto(o sb.offers) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; category_label text; subcategory_label text;
BEGIN
 result=sb.workspace_offer_dto_without_taxonomy(o);
 SELECT label INTO category_label FROM sb.categories WHERE id=o.category_id;
 SELECT label INTO subcategory_label FROM sb.categories WHERE id=o.subcategory_id;
 RETURN result||jsonb_build_object('categoryId',o.category_id,'subcategoryId',o.subcategory_id,'category',category_label,'subcategory',subcategory_label,'classificationReviewRequired',o.classification_review_required,
  'data',(result->'data')||jsonb_strip_nulls(jsonb_build_object('categoryId',o.category_id,'subcategoryId',o.subcategory_id,'category',category_label,'subcategory',subcategory_label)));
END $$;
DROP FUNCTION sb.workspace_offers(text,text,text,integer,integer);
CREATE FUNCTION sb.workspace_offers(search_text text DEFAULT '',state text DEFAULT '',sort_order text DEFAULT 'newest',page_number integer DEFAULT 1,page_size integer DEFAULT 12,category_uuid uuid DEFAULT NULL,subcategory_uuid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT sb.has_permission('offers.read') THEN RAISE EXCEPTION 'Offer permission required' USING ERRCODE='42501'; END IF;
 IF search_text IS NULL OR length(search_text)>100 OR state IS NULL OR state NOT IN ('','draft','submitted','clarification_requested','approved','rejected','archived') OR sort_order IS NULL OR sort_order NOT IN ('newest','oldest','updated','price_asc','price_desc') OR page_number IS NULL OR page_number<1 OR page_number>100000 OR page_size IS NULL OR page_size<1 OR page_size>24 THEN RAISE EXCEPTION 'Invalid workspace filter' USING ERRCODE='22023'; END IF;
 IF category_uuid IS NOT NULL AND NOT EXISTS(SELECT FROM sb.categories WHERE id=category_uuid AND parent_id IS NULL) OR subcategory_uuid IS NOT NULL AND NOT EXISTS(SELECT FROM sb.categories WHERE id=subcategory_uuid AND parent_id=category_uuid) THEN RAISE EXCEPTION 'Invalid classification filter' USING ERRCODE='22023'; END IF;
 WITH projected AS MATERIALIZED (SELECT o.public_id,o.created_at,o.updated_at,o.category_id,o.subcategory_id,sb.workspace_offer_dto(o) AS entry FROM sb.offers o WHERE state='' OR o.status=state),
 searched AS MATERIALIZED (SELECT * FROM projected WHERE search_text='' OR strpos(lower(public_id||' '||(entry->'data')::text),lower(search_text))>0),
 filtered AS MATERIALIZED (SELECT * FROM searched WHERE (category_uuid IS NULL OR category_id=category_uuid) AND (subcategory_uuid IS NULL OR subcategory_id=subcategory_uuid)),
 ordered AS (SELECT * FROM filtered ORDER BY
  CASE WHEN sort_order='oldest' THEN created_at END ASC,
  CASE WHEN sort_order='newest' THEN created_at END DESC,
  CASE WHEN sort_order='updated' THEN updated_at END DESC,
  CASE WHEN sort_order='price_asc' AND jsonb_typeof(entry->'data'->'price')='number' THEN (entry->'data'->>'price')::numeric END ASC NULLS LAST,
  CASE WHEN sort_order='price_desc' AND jsonb_typeof(entry->'data'->'price')='number' THEN (entry->'data'->>'price')::numeric END DESC NULLS LAST,
  public_id LIMIT page_size OFFSET ((page_number-1)*page_size))
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(entry) FROM ordered),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',page_number,'limit',page_size,'pages',greatest(1,ceil((SELECT count(*) FROM filtered)::numeric/page_size)),
 'categoryCounts',coalesce((SELECT jsonb_agg(jsonb_build_object('categoryId',category_id,'count',amount)) FROM (SELECT category_id,count(*) AS amount FROM searched GROUP BY category_id ORDER BY category_id) counts),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

-- Update the existing reviewed-card allowlist, preserving independent RBAC and
-- qualification gates. UUID taxonomy IDs are harmless public classification.
CREATE OR REPLACE FUNCTION sb.publish_opportunity_internal(source_offer uuid,sanitized_data jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE opportunity text; reviewed jsonb;
BEGIN
 IF NOT sb.is_staff() THEN RAISE EXCEPTION 'Management permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM sb.offers WHERE id=source_offer AND status='approved' AND NOT classification_review_required) THEN RAISE EXCEPTION 'Approved and classified source offer required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(sanitized_data)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(sanitized_data) k WHERE k NOT IN ('title','categoryId','subcategoryId','category','specification','quantity','unit','price','currency','incoterms','availability','validUntil')) THEN RAISE EXCEPTION 'Only approved anonymous fields are accepted' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_each(sanitized_data) x WHERE NOT (jsonb_typeof(x.value)='string' OR (x.key IN ('quantity','price') AND jsonb_typeof(x.value)='number') OR (x.key='subcategoryId' AND x.value='null'::jsonb)) OR length(x.value #>> '{}')>2000) THEN RAISE EXCEPTION 'Anonymous values must be reviewed text or commercial numbers' USING ERRCODE='22023'; END IF;
 reviewed=sanitized_data-'categoryId'-'subcategoryId';
 IF reviewed::text ~* '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|https?://|www\.)' THEN RAISE EXCEPTION 'Contact details are forbidden in anonymous cards' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM sb.offers o JOIN sb.companies c ON c.id=o.company_id WHERE o.id=source_offer AND (strpos(lower(reviewed::text),lower(c.legal_name))>0 OR (length(c.registration_number)>3 AND strpos(lower(reviewed::text),lower(c.registration_number))>0))) THEN RAISE EXCEPTION 'Source identity is forbidden in anonymous cards' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT FROM sb.offers WHERE id=source_offer AND category_id=(sanitized_data->>'categoryId')::uuid AND subcategory_id IS NOT DISTINCT FROM nullif(sanitized_data->>'subcategoryId','')::uuid) THEN RAISE EXCEPTION 'Anonymous classification must match the reviewed source' USING ERRCODE='22023'; END IF;
 INSERT INTO portal.opportunities(data) VALUES(sanitized_data) RETURNING public_id INTO opportunity;
 INSERT INTO sb.opportunity_sources(public_id,offer_id) VALUES(opportunity,source_offer);
 RETURN opportunity;
END $$;

ALTER TABLE sb.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE sb.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb.currencies FORCE ROW LEVEL SECURITY;
-- Parent/child activation is checked by category_guard, avoiding a recursive
-- self-query inside a category RLS policy.
CREATE POLICY catalogue_read ON sb.categories FOR SELECT TO shadowbridge_api USING((NOT technical AND active) OR sb.has_permission('taxonomy.read'));
CREATE POLICY currency_read ON sb.currencies FOR SELECT TO shadowbridge_api USING(active);
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON sb.categories FOR EACH ROW EXECUTE FUNCTION sb.audit_change();
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON sb.currencies FOR EACH ROW EXECUTE FUNCTION sb.audit_change();
GRANT SELECT ON sb.categories,sb.currencies TO shadowbridge_api;
GRANT SELECT,INSERT,UPDATE ON sb.categories,sb.currencies TO shadowbridge_policy;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sb' AND p.proname IN ('catalog','guard_category_change','create_category','update_category','enforce_record_classification','workspace_offer_dto','workspace_offer_dto_without_taxonomy','workspace_offers','publish_opportunity_internal') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_policy',f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION sb.workspace_offer_dto_without_taxonomy(sb.offers),sb.publish_opportunity_internal(uuid,jsonb) FROM shadowbridge_api,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION sb.catalog(boolean),sb.create_category(text,text,uuid,boolean,integer),sb.update_category(uuid,jsonb),sb.workspace_offers(text,text,text,integer,integer,uuid,uuid) TO shadowbridge_api;
COMMIT;
