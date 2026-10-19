-- Real PostgreSQL/RLS integration test. All fictional fixtures are rolled back.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-00000000d701','workspace.owner@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d702','workspace.procurement@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d703','workspace.analyst@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d704','workspace.supplier@test.shadowbridge.invalid',now()),
 ('00000000-0000-4000-8000-00000000d705','workspace.buyer@test.shadowbridge.invalid',now());
INSERT INTO sb.staff_grants(user_id,active) VALUES
 ('00000000-0000-4000-8000-00000000d701',true),('00000000-0000-4000-8000-00000000d702',true),('00000000-0000-4000-8000-00000000d703',true);
INSERT INTO sb.staff_role_assignments(user_id,role_key) VALUES
 ('00000000-0000-4000-8000-00000000d701','owner'),('00000000-0000-4000-8000-00000000d702','procurement_manager'),('00000000-0000-4000-8000-00000000d703','staff_analyst');
INSERT INTO sb.staff_permission_overrides(user_id,permission,effect) VALUES('00000000-0000-4000-8000-00000000d703','offers.read','allow');
INSERT INTO sb.companies(id,legal_name,registration_number,country,created_by) VALUES
 ('00000000-0000-4000-8000-00000000d711','FICTIONAL SUPPLIER SENSITIVE LTD','FICTIONAL-SECRET-0711','Norway','00000000-0000-4000-8000-00000000d704'),
 ('00000000-0000-4000-8000-00000000d712','FICTIONAL BUYER ISOLATED LTD','FICTIONAL-SECRET-0712','Norway','00000000-0000-4000-8000-00000000d705');
INSERT INTO sb.memberships(user_id,company_id,role,status) VALUES
 ('00000000-0000-4000-8000-00000000d704','00000000-0000-4000-8000-00000000d711','supplier','approved'),
 ('00000000-0000-4000-8000-00000000d705','00000000-0000-4000-8000-00000000d712','buyer','approved');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d704',true),set_config('request.jwt.claim.aal','aal1',true);
INSERT INTO sb.offers(public_id,company_id,created_by,status,data)
 SELECT 'SB-OF-WORKSPACE-TEST-'||lpad(n::text,4,'0'),'00000000-0000-4000-8000-00000000d711','00000000-0000-4000-8000-00000000d704','submitted',
 jsonb_build_object('categoryId','10000000-0000-4000-8000-000000000001','productName','FICTIONAL SUPPLIER SENSITIVE LTD offer '||n,'description','Contact fixture@test.shadowbridge.invalid https://supplier.invalid','quantity',n*10,'price',n,'currency','EUR','unit','kg','incoterms','FCA','dimensions','Fictional 100 x 50 x 50 cm','weight','Fictional 20 kg','packaging','Fictional boxes','transport','Fictional local test only') FROM generate_series(1,27) n;
SET LOCAL ROLE shadowbridge_api;
DO $$ BEGIN
 BEGIN PERFORM sb.workspace_offers(); RAISE EXCEPTION 'Supplier entered internal workspace'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT FROM sb.supplier_qualifications) THEN RAISE EXCEPTION 'Supplier read internal qualification records'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d705',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM sb.offers WHERE public_id LIKE 'SB-OF-WORKSPACE-TEST-%') THEN RAISE EXCEPTION 'Buyer read supplier source offers'; END IF;
 BEGIN PERFORM sb.workspace_offer('SB-OF-WORKSPACE-TEST-0001'); RAISE EXCEPTION 'Buyer entered internal detail'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d703',true);
DO $$ BEGIN
 BEGIN PERFORM sb.workspace_offers(); RAISE EXCEPTION 'Staff bypassed MFA'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.aal','aal2',true);
DO $$ DECLARE first_page jsonb; last_page jsonb; detail jsonb; BEGIN
 IF EXISTS(SELECT FROM sb.offers WHERE public_id LIKE 'SB-OF-WORKSPACE-TEST-%') THEN RAISE EXCEPTION 'Anonymous staff read raw supplier source data'; END IF;
 first_page=sb.workspace_offers('SB-OF-WORKSPACE-TEST-','submitted','oldest',1,12);
 last_page=sb.workspace_offers('SB-OF-WORKSPACE-TEST-','submitted','oldest',3,12);
 IF (first_page->>'total')::integer<>27 OR jsonb_array_length(first_page->'items')<>12 OR jsonb_array_length(last_page->'items')<>3 OR (first_page->>'pages')::integer<>3 THEN RAISE EXCEPTION 'Workspace pagination failed'; END IF;
 IF (sb.workspace_offers('supplier.invalid','','newest',1,12)->>'total')::integer<>0 THEN RAISE EXCEPTION 'Restricted search leaked unreviewed source information'; END IF;
 IF first_page::text ~ '(FICTIONAL SUPPLIER|FICTIONAL-SECRET|fixture@|supplier.invalid|d711|d704|company_id|created_by)' THEN RAISE EXCEPTION 'Redacted workspace leaked source identity'; END IF;
 detail=sb.workspace_offer('SB-OF-WORKSPACE-TEST-0001');
 IF detail->'data'->>'productName'<>'Confidential offer' OR (detail->>'identityRestricted')::boolean IS NOT TRUE OR (detail->'media'->>'uploadEnabled')::boolean IS NOT FALSE OR jsonb_array_length(detail->'media'->'photos')<>0 THEN RAISE EXCEPTION 'Private identity or disabled media projection failed'; END IF;
 IF jsonb_array_length(detail->'history')<>1 THEN RAISE EXCEPTION 'Offer insert history missing'; END IF;
 BEGIN PERFORM sb.workspace_offers('','','newest',1,25); RAISE EXCEPTION 'Workspace accepted unbounded page'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','archived','Fictional forbidden archive.'); RAISE EXCEPTION 'Read-only staff archived offer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM sb.assign_workspace_offer('SB-OF-WORKSPACE-TEST-0001','me'); RAISE EXCEPTION 'Read-only staff assigned offer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM sb.review_supplier_qualification('SB-OF-WORKSPACE-TEST-0001','company','verified','manufacturer','Fictional evidence only, not a real supplier.','FICTIONAL-REVIEW'); RAISE EXCEPTION 'Read-only staff approved supplier'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d702',true);
DO $$ DECLARE detail jsonb; BEGIN
 detail=sb.workspace_offer('SB-OF-WORKSPACE-TEST-0001');
 IF detail->'data'->>'productName'<>'FICTIONAL SUPPLIER SENSITIVE LTD offer 1' OR (detail->>'identityRestricted')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Authorized procurement source projection failed'; END IF;
 BEGIN PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','approved','Fictional review decision.'); RAISE EXCEPTION 'Registration approval incorrectly qualified supplier'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN UPDATE sb.offers SET status='approved' WHERE public_id='SB-OF-WORKSPACE-TEST-0001'; RAISE EXCEPTION 'Direct SQL bypassed supplier qualification'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM sb.review_supplier_qualification('SB-OF-WORKSPACE-TEST-0001','decision','verified','manufacturer','Fictional evidence only, not a real supplier.','FICTIONAL-REVIEW'); RAISE EXCEPTION 'Supplier qualification skipped stages'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM sb.review_supplier_qualification('SB-OF-WORKSPACE-TEST-0001','company','verified','manufacturer','Fictional company registry reviewed for a local test.','FICTIONAL-COMPANY-REVIEW');
 PERFORM sb.review_supplier_qualification('SB-OF-WORKSPACE-TEST-0001','right_to_sell','verified','manufacturer','Fictional right-to-sell evidence reviewed for a local test.','FICTIONAL-AUTHORIZATION');
 PERFORM sb.review_supplier_qualification('SB-OF-WORKSPACE-TEST-0001','documents_goods','verified','manufacturer','Fictional documents and goods reviewed for a local test.','FICTIONAL-DOCUMENTS');
 PERFORM sb.review_supplier_qualification('SB-OF-WORKSPACE-TEST-0001','decision','verified','manufacturer','Fictional supplier cooperation approved for a local test.','FICTIONAL-APPROVAL');
 PERFORM sb.set_workspace_source('SB-OF-WORKSPACE-TEST-0001','marketplace_copy','Fictional copied marketplace source identified during local test.');
 BEGIN PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','approved','Fictional review decision.'); RAISE EXCEPTION 'Marketplace copy was treated as owned verified stock'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM sb.set_workspace_source('SB-OF-WORKSPACE-TEST-0001','supplier_owned','Fictional ownership evidence reviewed, no real goods involved.');
 PERFORM sb.assign_workspace_offer('SB-OF-WORKSPACE-TEST-0001','me');
 PERFORM sb.edit_workspace_offer('SB-OF-WORKSPACE-TEST-0001','{"dimensions":"Fictional 120 x 80 x 100 cm","weight":"Fictional 90 kg","packaging":"Fictional pallets","transport":"Fictional road transport"}');
 BEGIN PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','approved','Fictional stale source review.'); RAISE EXCEPTION 'Changed source retained its earlier review'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM sb.set_workspace_source('SB-OF-WORKSPACE-TEST-0001','supplier_owned','Fictional changed source evidence reviewed, no real goods involved.');
 PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','approved','Fictional complete source review.');
 detail=sb.workspace_offer('SB-OF-WORKSPACE-TEST-0001');
 IF detail->>'status'<>'approved' OR detail->'verification'->>'stage'<>'approved_cooperation' OR detail->'verification'->>'sellerKind'<>'manufacturer' OR NOT (detail->'responsible'->>'isSelf')::boolean THEN RAISE EXCEPTION 'Qualified operational workflow failed'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(detail->'history') item WHERE item->>'action'='assignment') OR jsonb_array_length(detail->'history')<5 THEN RAISE EXCEPTION 'Offer history omitted decisions or responsibility'; END IF;
 BEGIN UPDATE sb.offer_revisions SET action='tampered'; RAISE EXCEPTION 'History was editable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE sb.offers SET data=data||'{"price":99}' WHERE public_id='SB-OF-WORKSPACE-TEST-0001'; RAISE EXCEPTION 'Changed approved offer skipped re-review'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','archived','Fictional offer closed after local test.');
 detail=sb.workspace_offer('SB-OF-WORKSPACE-TEST-0001');
 IF detail->>'status'<>'archived' OR NOT EXISTS(SELECT FROM jsonb_array_elements(detail->'decisionNotes') n WHERE n->>'decision'='archived') THEN RAISE EXCEPTION 'Archived decision or recorded reason missing'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d701',true);
DO $$ DECLARE card text; source_id uuid; BEGIN
 PERFORM sb.decide_workspace_offer('SB-OF-WORKSPACE-TEST-0001','approved','Fictional renewed approval to verify controlled anonymous withdrawal.');
 SELECT id INTO source_id FROM sb.offers WHERE public_id='SB-OF-WORKSPACE-TEST-0001';
 card=sb.publish_opportunity(source_id,'{"title":"Generic reviewed test material","categoryId":"10000000-0000-4000-8000-000000000001","specification":"Reviewed anonymous fictional commercial information.","quantity":10,"unit":"kg","currency":"PLN"}'::jsonb);
 PERFORM sb.grant_opportunity(card,'00000000-0000-4000-8000-00000000d712','buyer');
 PERFORM set_config('test.workspace_card',card,true);
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d705',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM portal.opportunities WHERE public_id=current_setting('test.workspace_card') AND status='approved') THEN RAISE EXCEPTION 'Individually granted buyer did not receive reviewed anonymous card'; END IF;
 IF EXISTS(SELECT FROM sb.offers WHERE public_id='SB-OF-WORKSPACE-TEST-0001') THEN RAISE EXCEPTION 'Anonymous assignment leaked supplier source'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d701',true),set_config('request.jwt.claim.aal','aal2',true);
DO $$ BEGIN
 PERFORM sb.edit_workspace_offer('SB-OF-WORKSPACE-TEST-0001','{"price":48,"currency":"PLN"}'::jsonb);
 IF NOT EXISTS(SELECT FROM portal.opportunities WHERE public_id=current_setting('test.workspace_card') AND status='withdrawn') THEN RAISE EXCEPTION 'Editing source left its old anonymous card published'; END IF;
 BEGIN UPDATE portal.opportunities SET status='approved' WHERE public_id=current_setting('test.workspace_card'); RAISE EXCEPTION 'Status update bypassed fresh anonymous review'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d705',true),set_config('request.jwt.claim.aal','aal1',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM portal.opportunities WHERE public_id=current_setting('test.workspace_card')) THEN RAISE EXCEPTION 'Buyer retained withdrawn anonymous information'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sb' AND c.relname IN ('offer_workspace','offer_revisions','offer_decision_notes','supplier_qualifications','supplier_qualification_reviews') AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'Workspace table lacks forced RLS'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='sb' AND p.proname IN ('workspace_offer_dto','workspace_offers','workspace_offer','assign_workspace_offer','set_workspace_source','edit_workspace_offer','decide_workspace_offer','review_supplier_qualification','workspace_supplier_qualification') AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Workspace function is executable by PUBLIC'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: actual PostgreSQL workspace pagination, permission/MFA enforcement, anonymous projection, sequential supplier qualification, source evidence, approval guards and immutable audit history'
