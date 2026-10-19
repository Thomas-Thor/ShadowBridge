-- Real PostgreSQL tests. All fictional accounts/records roll back atomically.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-00000000e801','taxonomy.owner@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e802','taxonomy.procurement@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e803','taxonomy.analyst@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e804','taxonomy.buyer.one@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e805','taxonomy.buyer.two@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e806','taxonomy.supplier.one@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e807','taxonomy.supplier.two@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000e808','taxonomy.buyer.colleague@test.shadowbridge.invalid',now());
SELECT sb.bootstrap_owner('00000000-0000-4000-8000-00000000e801');
INSERT INTO sb.staff_grants(user_id,active) VALUES ('00000000-0000-4000-8000-00000000e802',true),('00000000-0000-4000-8000-00000000e803',true);
INSERT INTO sb.staff_role_assignments(user_id,role_key) VALUES ('00000000-0000-4000-8000-00000000e802','procurement_manager'),('00000000-0000-4000-8000-00000000e803','staff_analyst');
INSERT INTO sb.companies(id,legal_name,registration_number,country,created_by) VALUES
 ('00000000-0000-4000-8000-00000000e811','FICTIONAL Taxonomy Buyer One','TAX-BUYER-ONE','Norway','00000000-0000-4000-8000-00000000e804'),
 ('00000000-0000-4000-8000-00000000e812','FICTIONAL Taxonomy Buyer Two','TAX-BUYER-TWO','Norway','00000000-0000-4000-8000-00000000e805'),
 ('00000000-0000-4000-8000-00000000e813','FICTIONAL Confidential Supplier One','TAX-SUPPLIER-ONE','Norway','00000000-0000-4000-8000-00000000e806'),
 ('00000000-0000-4000-8000-00000000e814','FICTIONAL Confidential Supplier Two','TAX-SUPPLIER-TWO','Norway','00000000-0000-4000-8000-00000000e807');
INSERT INTO sb.memberships(user_id,company_id,role,status) VALUES
 ('00000000-0000-4000-8000-00000000e804','00000000-0000-4000-8000-00000000e811','buyer','approved'),
 ('00000000-0000-4000-8000-00000000e805','00000000-0000-4000-8000-00000000e812','buyer','approved'),
 ('00000000-0000-4000-8000-00000000e806','00000000-0000-4000-8000-00000000e813','supplier','approved'),
 ('00000000-0000-4000-8000-00000000e807','00000000-0000-4000-8000-00000000e814','supplier','approved'),
 ('00000000-0000-4000-8000-00000000e808','00000000-0000-4000-8000-00000000e811','buyer','approved');
SET LOCAL ROLE shadowbridge_api;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.aal','',true);
DO $$ DECLARE catalogue jsonb; BEGIN
 catalogue=sb.catalog(false);
 IF (SELECT count(*) FROM jsonb_array_elements(catalogue->'categories') c WHERE c->>'parentId' IS NULL AND c->>'key' IN ('food-agriculture','water-beverages','machinery-equipment','industrial-supplies','hotel-hospitality','energy-infrastructure','emergency-humanitarian','other-opportunities'))<>8 THEN RAISE EXCEPTION 'Initial public roots omit an approved category'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(catalogue->'categories') c WHERE c->>'key'='unclassified') THEN RAISE EXCEPTION 'Technical legacy category leaked into selection'; END IF;
 IF NOT catalogue->'currencies' @> '[{"code":"PLN"}]'::jsonb THEN RAISE EXCEPTION 'PLN source currency missing'; END IF;
 BEGIN PERFORM sb.catalog(true);RAISE EXCEPTION 'Anonymous role read management catalogue';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM sb.create_category('not-permitted','Not permitted');RAISE EXCEPTION 'Anonymous role created a category';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e802',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 BEGIN PERFORM sb.create_category('mfa-required','MFA required');RAISE EXCEPTION 'Classification management bypassed MFA';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.aal','aal2',true);
SELECT (sb.create_category('fictional-taxonomy-root','FICTIONAL Taxonomy Test Root',NULL,true,9000)->>'id') AS root_id \gset
SELECT set_config('test.taxonomy_root',:'root_id',true);
SELECT (sb.create_category('fictional-taxonomy-child','FICTIONAL Taxonomy Test Child',:'root_id',true,9010)->>'id') AS child_id \gset
SELECT set_config('test.taxonomy_child',:'child_id',true);
DO $$ BEGIN
 BEGIN PERFORM sb.update_category(current_setting('test.taxonomy_root')::uuid,'{"active":false}');RAISE EXCEPTION 'Active child allowed inactive parent';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN DELETE FROM sb.categories WHERE id=current_setting('test.taxonomy_child')::uuid;RAISE EXCEPTION 'API hard-deleted classification';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM sb.update_category(current_setting('test.taxonomy_child')::uuid,'{"parentId":null}');RAISE EXCEPTION 'Classification parent changed behind existing records';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM sb.update_category(current_setting('test.taxonomy_child')::uuid,'{"label":"FICTIONAL Updated Child"}');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.audit_events WHERE actor_id='00000000-0000-4000-8000-00000000e802' AND resource='sb.categories' AND resource_id=current_setting('test.taxonomy_child') AND action='update') THEN RAISE EXCEPTION 'Category modification lacks audit'; END IF;
END $$;
SET LOCAL ROLE shadowbridge_api;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
DO $$ BEGIN
 BEGIN PERFORM sb.update_category(current_setting('test.taxonomy_child')::uuid,'{"active":false}');RAISE EXCEPTION 'Analyst gained taxonomy edit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e806',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.offers(public_id,company_id,created_by,status,data)
 VALUES('SB-OF-TAX-ONE','00000000-0000-4000-8000-00000000e813',sb.user_id(),'submitted',jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'subcategoryId',current_setting('test.taxonomy_child'),'category','Untrusted caller label','productName','FICTIONAL private supplier source','quantity',10,'price',25,'currency','PLN'));
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.offers WHERE public_id='SB-OF-TAX-ONE' AND category_id=current_setting('test.taxonomy_root')::uuid AND subcategory_id=current_setting('test.taxonomy_child')::uuid AND NOT classification_review_required AND data->>'category'='FICTIONAL Taxonomy Test Root' AND data->>'subcategory'='FICTIONAL Updated Child' AND data->>'currency'='PLN') THEN RAISE EXCEPTION 'Category FK/canonical labels/PLN were not persisted'; END IF;
 BEGIN INSERT INTO sb.offers(company_id,created_by,data) VALUES('00000000-0000-4000-8000-00000000e813',sb.user_id(),'{"category":"Manual text is not an ID"}');RAISE EXCEPTION 'Missing category ID was accepted by DB';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN INSERT INTO sb.offers(company_id,created_by,data) VALUES('00000000-0000-4000-8000-00000000e813',sb.user_id(),jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'subcategoryId','10000000-0000-4000-8000-000000000101'));RAISE EXCEPTION 'Cross-root subcategory was accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN INSERT INTO sb.offers(company_id,created_by,data) VALUES('00000000-0000-4000-8000-00000000e813',sb.user_id(),jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'currency','CHF'));RAISE EXCEPTION 'Unsupported currency was accepted by DB';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN INSERT INTO sb.offers(company_id,created_by,data) VALUES('00000000-0000-4000-8000-00000000e813',sb.user_id(),'{"categoryId":"10000000-0000-4000-8000-000000000000"}');RAISE EXCEPTION 'Supplier selected technical legacy category';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e807',true);
INSERT INTO sb.offers(public_id,company_id,created_by,status,data)
 VALUES('SB-OF-TAX-TWO','00000000-0000-4000-8000-00000000e814',sb.user_id(),'submitted',jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'productName','FICTIONAL second private source','quantity',20,'price',50,'currency','EUR'));
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.offers WHERE public_id='SB-OF-TAX-ONE') THEN RAISE EXCEPTION 'Supplier read another company offer'; END IF;
 BEGIN PERFORM sb.workspace_offers();RAISE EXCEPTION 'Supplier entered management workspace';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
-- Fictional qualification fixture only; normal UI tests exercise ordered reviews.
UPDATE sb.supplier_qualifications SET stage='approved_cooperation',status='approved',seller_kind='stock_owner' WHERE company_id IN ('00000000-0000-4000-8000-00000000e813','00000000-0000-4000-8000-00000000e814');
UPDATE sb.offer_workspace SET source_kind='supplier_owned' WHERE offer_id IN (SELECT id FROM sb.offers WHERE public_id IN ('SB-OF-TAX-ONE','SB-OF-TAX-TWO'));
SET LOCAL ROLE shadowbridge_api;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e801',true),set_config('request.jwt.claim.aal','aal2',true);
UPDATE sb.offers SET status='approved' WHERE public_id IN ('SB-OF-TAX-ONE','SB-OF-TAX-TWO');
DO $$ DECLARE page jsonb; BEGIN
 page=sb.workspace_offers('','approved','newest',1,1,current_setting('test.taxonomy_root')::uuid,NULL);
 IF (page->>'total')::integer<>2 OR jsonb_array_length(page->'items')<>1 OR (page->>'pages')::integer<>2 THEN RAISE EXCEPTION 'Workspace category paging/count mismatch'; END IF;
 IF NOT page->'categoryCounts' @> jsonb_build_array(jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'count',2)) THEN RAISE EXCEPTION 'Category counts missing'; END IF;
 page=sb.workspace_offers('','approved','price_asc',1,12,current_setting('test.taxonomy_root')::uuid,current_setting('test.taxonomy_child')::uuid);
 IF (page->>'total')::integer<>1 OR page->'items'->0->>'id'<>'SB-OF-TAX-ONE' THEN RAISE EXCEPTION 'Subcategory filter wrong'; END IF;
 BEGIN PERFORM sb.publish_opportunity((SELECT id FROM sb.offers WHERE public_id='SB-OF-TAX-ONE'),'{"title":"FICTIONAL anonymous goods","specification":"Anonymous approved details","categoryId":"10000000-0000-4000-8000-000000000001"}');RAISE EXCEPTION 'Anonymous card silently used a different category';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
SELECT sb.publish_opportunity((SELECT id FROM sb.offers WHERE public_id='SB-OF-TAX-ONE'),jsonb_build_object('title','FICTIONAL approved opportunity','specification','Anonymous commercial information only','categoryId',current_setting('test.taxonomy_root'),'subcategoryId',current_setting('test.taxonomy_child'),'subcategory','Caller label must be replaced','currency','PLN','price',25)) AS opportunity_one \gset
SELECT set_config('test.taxonomy_opportunity_one',:'opportunity_one',true);
SELECT sb.publish_opportunity((SELECT id FROM sb.offers WHERE public_id='SB-OF-TAX-TWO'),jsonb_build_object('title','FICTIONAL different approved opportunity','specification','Separate selected buyer','categoryId',current_setting('test.taxonomy_root'),'currency','EUR')) AS opportunity_two \gset
SELECT set_config('test.taxonomy_opportunity_two',:'opportunity_two',true);
SELECT sb.grant_opportunity(:'opportunity_one','00000000-0000-4000-8000-00000000e811','buyer');
SELECT sb.grant_opportunity(:'opportunity_two','00000000-0000-4000-8000-00000000e812','buyer');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e804',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.rfqs(public_id,company_id,created_by,status,data) VALUES('SB-RFQ-TAX-ONE','00000000-0000-4000-8000-00000000e811',sb.user_id(),'submitted',jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'subcategoryId',current_setting('test.taxonomy_child'),'product','FICTIONAL buyer request','currency','PLN'));
DO $$ BEGIN
 IF (SELECT count(*) FROM portal.opportunities WHERE category_id=current_setting('test.taxonomy_root')::uuid)<>1 THEN RAISE EXCEPTION 'Buyer category counts include unassigned opportunities'; END IF;
 IF EXISTS(SELECT FROM portal.opportunities WHERE public_id=current_setting('test.taxonomy_opportunity_two')) THEN RAISE EXCEPTION 'Buyer read unassigned card'; END IF;
 IF EXISTS(SELECT FROM sb.offers) THEN RAISE EXCEPTION 'Buyer read confidential supplier catalogue'; END IF;
 IF (SELECT data::text FROM portal.opportunities WHERE public_id=current_setting('test.taxonomy_opportunity_one')) ~ '(TAX-SUPPLIER|Confidential Supplier|e813|e806|supplier.one)' THEN RAISE EXCEPTION 'Counterparty source leaked through category DTO'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e808',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.rfqs WHERE public_id='SB-RFQ-TAX-ONE') THEN RAISE EXCEPTION 'Approved company colleague cannot read own company RFQ'; END IF;
 IF (SELECT count(*) FROM portal.opportunities WHERE category_id=current_setting('test.taxonomy_root')::uuid)<>1 THEN RAISE EXCEPTION 'Company colleague lost own assigned card'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e805',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.rfqs WHERE public_id='SB-RFQ-TAX-ONE') THEN RAISE EXCEPTION 'Other buyer read confidential RFQ'; END IF;
 IF (SELECT count(*) FROM portal.opportunities WHERE category_id=current_setting('test.taxonomy_root')::uuid)<>1 OR EXISTS(SELECT FROM portal.opportunities WHERE public_id=current_setting('test.taxonomy_opportunity_one')) THEN RAISE EXCEPTION 'Other buyer saw an unassigned opportunity'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e802',true),set_config('request.jwt.claim.aal','aal2',true);
SELECT sb.update_category(current_setting('test.taxonomy_child')::uuid,'{"active":false}');
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.categories WHERE id=current_setting('test.taxonomy_child')::uuid AND NOT active) THEN RAISE EXCEPTION 'Used category could not be safely deactivated'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(sb.catalog(false)->'categories') c WHERE c->>'id'=current_setting('test.taxonomy_child')) THEN RAISE EXCEPTION 'Inactive category remained selectable'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e806',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM sb.offers WHERE public_id='SB-OF-TAX-ONE' AND subcategory_id=current_setting('test.taxonomy_child')::uuid) THEN RAISE EXCEPTION 'Deactivation broke existing record FK/history'; END IF;
 BEGIN INSERT INTO sb.offers(company_id,created_by,data) VALUES('00000000-0000-4000-8000-00000000e813',sb.user_id(),jsonb_build_object('categoryId',current_setting('test.taxonomy_root'),'subcategoryId',current_setting('test.taxonomy_child')));RAISE EXCEPTION 'Inactive subcategory was accepted for new offer';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.offers WHERE category_id IS NULL) OR EXISTS(SELECT FROM sb.rfqs WHERE category_id IS NULL) OR EXISTS(SELECT FROM portal.opportunities WHERE category_id IS NULL) THEN RAISE EXCEPTION 'Legacy record lost valid category FK'; END IF;
 IF EXISTS(SELECT FROM sb.offers o WHERE classification_review_required AND category_id<>'10000000-0000-4000-8000-000000000000') OR EXISTS(SELECT FROM sb.rfqs o WHERE classification_review_required AND category_id<>'10000000-0000-4000-8000-000000000000') THEN RAISE EXCEPTION 'Ambiguous record silently assigned a business category'; END IF;
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sb' AND c.relname IN ('categories','currencies') AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Catalogue tables lack forced RLS'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: real controlled taxonomy/FKs, canonical labels, permission/MFA CRUD, PLN, subcategory validation, paginated workspace, anonymous-card classification and multi-company isolation'
