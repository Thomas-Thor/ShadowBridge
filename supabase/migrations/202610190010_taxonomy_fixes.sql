-- Add canonical derived subcategory labels to reviewed-card round trips and
-- serialize parent/child activation. Migration008 is immutable once applied.
BEGIN;
CREATE OR REPLACE FUNCTION sb.guard_category_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF tg_op='UPDATE' AND (new.id<>old.id OR new.key<>old.key OR new.parent_id IS DISTINCT FROM old.parent_id OR new.technical IS DISTINCT FROM old.technical OR new.created_at<>old.created_at) THEN RAISE EXCEPTION 'Classification identity and parent are immutable; create a new classification instead' USING ERRCODE='22023'; END IF;
 IF new.technical THEN RAISE EXCEPTION 'Technical category is reserved for migration review' USING ERRCODE='42501'; END IF;
 IF new.parent_id IS NOT NULL THEN
  -- SHARE conflicts with parent deactivation's row lock. Concurrent category
  -- creation/deactivation cannot leave an active child below an inactive root.
  PERFORM 1 FROM sb.categories WHERE id=new.parent_id AND parent_id IS NULL AND NOT technical AND (active OR NOT new.active) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active root category as parent' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT new.active AND EXISTS(SELECT FROM sb.categories WHERE parent_id=new.id AND active) THEN RAISE EXCEPTION 'Deactivate subcategories before their parent' USING ERRCODE='22023'; END IF;
 new.updated_at=now();RETURN new;
END $$;
CREATE OR REPLACE FUNCTION sb.publish_opportunity_internal(source_offer uuid,sanitized_data jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE opportunity text; reviewed jsonb;
BEGIN
 IF NOT sb.is_staff() THEN RAISE EXCEPTION 'Management permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM sb.offers WHERE id=source_offer AND status='approved' AND NOT classification_review_required) THEN RAISE EXCEPTION 'Approved and classified source offer required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(sanitized_data)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(sanitized_data) k WHERE k NOT IN ('title','categoryId','subcategoryId','category','subcategory','specification','quantity','unit','price','currency','incoterms','availability','validUntil')) THEN RAISE EXCEPTION 'Only approved anonymous fields are accepted' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_each(sanitized_data) x WHERE NOT (jsonb_typeof(x.value)='string' OR (x.key IN ('quantity','price') AND jsonb_typeof(x.value)='number') OR (x.key='subcategoryId' AND x.value='null'::jsonb)) OR length(x.value #>> '{}')>2000) THEN RAISE EXCEPTION 'Anonymous values must be reviewed text or commercial numbers' USING ERRCODE='22023'; END IF;
 reviewed=sanitized_data-'categoryId'-'subcategoryId';
 IF reviewed::text ~* '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|https?://|www\.)' THEN RAISE EXCEPTION 'Contact details are forbidden in anonymous cards' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM sb.offers o JOIN sb.companies c ON c.id=o.company_id WHERE o.id=source_offer AND (strpos(lower(reviewed::text),lower(c.legal_name))>0 OR (length(c.registration_number)>3 AND strpos(lower(reviewed::text),lower(c.registration_number))>0))) THEN RAISE EXCEPTION 'Source identity is forbidden in anonymous cards' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT FROM sb.offers WHERE id=source_offer AND category_id=(sanitized_data->>'categoryId')::uuid AND subcategory_id IS NOT DISTINCT FROM nullif(sanitized_data->>'subcategoryId','')::uuid) THEN RAISE EXCEPTION 'Anonymous classification must match the reviewed source' USING ERRCODE='22023'; END IF;
 INSERT INTO portal.opportunities(data) VALUES(sanitized_data) RETURNING public_id INTO opportunity;
 INSERT INTO sb.opportunity_sources(public_id,offer_id) VALUES(opportunity,source_offer);
 RETURN opportunity;
END $$;
ALTER FUNCTION sb.guard_category_change() OWNER TO shadowbridge_policy;
ALTER FUNCTION sb.publish_opportunity_internal(uuid,jsonb) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.guard_category_change(),sb.publish_opportunity_internal(uuid,jsonb) FROM PUBLIC,shadowbridge_api,shadowbridge_sessions;
COMMIT;
