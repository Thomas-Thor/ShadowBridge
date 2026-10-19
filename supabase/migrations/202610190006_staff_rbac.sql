-- Explicit role assignments replace the legacy all-or-nothing staff flag.
-- No existing staff_grant is promoted to OWNER by this migration.
BEGIN;
CREATE TABLE sb.staff_roles (
 key text PRIMARY KEY CHECK(key IN ('owner','general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst')),
 label text NOT NULL
);
INSERT INTO sb.staff_roles VALUES
 ('owner','OWNER'),('general_director','GENERAL DIRECTOR / CEO'),('operations_manager','OPERATIONS MANAGER'),
 ('procurement_manager','PROCUREMENT MANAGER'),('sales_manager','SALES MANAGER'),('compliance_finance','COMPLIANCE / FINANCE'),('staff_analyst','STAFF / ANALYST');
CREATE TABLE sb.staff_permissions (
 key text PRIMARY KEY,
 owner_controlled boolean NOT NULL DEFAULT false
);
INSERT INTO sb.staff_permissions(key)
 SELECT resource||'.'||action FROM (VALUES
 ('overview',ARRAY['read']),('counterparties',ARRAY['read']),('applications',ARRAY['read','approve','reject']),('accounts',ARRAY['read','suspend']),
 ('companies',ARRAY['read','edit','verify']),('memberships',ARRAY['read','edit']),
 ('offers',ARRAY['read','create','edit','approve','reject','archive']),('rfqs',ARRAY['read','create','edit','approve','reject']),
 ('proposals',ARRAY['read','create','edit','approve','reject']),('opportunities',ARRAY['read','create','edit','approve','reject','share']),
 ('messages',ARRAY['read','create']),('projects',ARRAY['read','create','edit','approve','reject']),
 ('commissions',ARRAY['read','create','edit','approve','reject']),('audit',ARRAY['read']),('contact',ARRAY['read','edit']),
 ('staff',ARRAY['read','manage']),('supplier_verifications',ARRAY['read','create','edit','approve','reject'])
 ) AS x(resource,actions) CROSS JOIN LATERAL unnest(x.actions) AS action;
INSERT INTO sb.staff_permissions VALUES ('counterparties.reveal',true),('strategic.manage',true),('security.manage',true);
CREATE TABLE sb.staff_role_permissions (
 role_key text REFERENCES sb.staff_roles(key),permission text REFERENCES sb.staff_permissions(key),PRIMARY KEY(role_key,permission)
);
INSERT INTO sb.staff_role_permissions SELECT 'owner',key FROM sb.staff_permissions;
INSERT INTO sb.staff_role_permissions SELECT 'general_director',key FROM sb.staff_permissions WHERE NOT owner_controlled;
INSERT INTO sb.staff_role_permissions SELECT r.role_key,p.key FROM (VALUES
 ('operations_manager',ARRAY['overview.read','counterparties.read','companies.read','memberships.read','offers.read','rfqs.read','proposals.read','opportunities.read','messages.read','messages.create','projects.read','projects.create','projects.edit','projects.approve','projects.reject','commissions.read','contact.read','contact.edit','staff.read','audit.read']),
 ('procurement_manager',ARRAY['overview.read','counterparties.read','companies.read','companies.edit','companies.verify','applications.read','applications.approve','applications.reject','memberships.read','offers.read','offers.create','offers.edit','offers.approve','offers.reject','offers.archive','opportunities.read','opportunities.create','opportunities.approve','messages.read','messages.create','supplier_verifications.read','supplier_verifications.create','supplier_verifications.edit','supplier_verifications.approve','supplier_verifications.reject','staff.read']),
 ('sales_manager',ARRAY['overview.read','counterparties.read','companies.read','applications.read','applications.approve','applications.reject','memberships.read','offers.read','rfqs.read','rfqs.create','rfqs.edit','rfqs.approve','rfqs.reject','opportunities.read','opportunities.create','opportunities.approve','opportunities.share','messages.read','messages.create','contact.read','contact.edit','staff.read']),
 ('compliance_finance',ARRAY['overview.read','counterparties.read','companies.read','companies.verify','accounts.read','applications.read','memberships.read','offers.read','rfqs.read','proposals.read','opportunities.read','projects.read','commissions.read','commissions.create','commissions.edit','commissions.approve','commissions.reject','supplier_verifications.read','supplier_verifications.edit','supplier_verifications.approve','supplier_verifications.reject','audit.read','staff.read']),
 ('staff_analyst',ARRAY['overview.read'])
 ) AS r(role_key,permissions) JOIN sb.staff_permissions p ON p.key=ANY(r.permissions);
CREATE TABLE sb.staff_role_assignments (
 user_id uuid REFERENCES sb.accounts(user_id),role_key text REFERENCES sb.staff_roles(key),active boolean NOT NULL DEFAULT true,
 expires_at timestamptz,assigned_by uuid REFERENCES sb.accounts(user_id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,role_key)
);
CREATE TABLE sb.staff_permission_overrides (
 user_id uuid REFERENCES sb.accounts(user_id),permission text REFERENCES sb.staff_permissions(key),effect text NOT NULL CHECK(effect IN ('allow','deny')),
 assigned_by uuid REFERENCES sb.accounts(user_id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,permission)
);
CREATE TABLE sb.staff_limits (
 user_id uuid PRIMARY KEY REFERENCES sb.accounts(user_id),commission_amount numeric(18,2) NOT NULL DEFAULT 10000 CHECK(commission_amount>=0),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency ~ '^[A-Z]{3}$'),updated_by uuid REFERENCES sb.accounts(user_id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb.risk_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requested_by uuid NOT NULL REFERENCES sb.accounts(user_id),action text NOT NULL CHECK(action IN ('commissions.create','commissions.edit')),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),amount numeric(18,2) NOT NULL CHECK(amount>=0),currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','consumed')),reviewed_by uuid REFERENCES sb.accounts(user_id),
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',consumed_at timestamptz,
 CHECK(reviewed_by IS NULL OR reviewed_by<>requested_by)
);
CREATE INDEX risk_approval_pending ON sb.risk_approvals(status,expires_at);

CREATE OR REPLACE FUNCTION sb.has_staff_grant() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(true) AND EXISTS(SELECT 1 FROM sb.staff_grants WHERE user_id=sb.user_id() AND active)
$$;
CREATE OR REPLACE FUNCTION sb.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.has_staff_grant() AND current_setting('request.jwt.claim.aal',true)='aal2' AND EXISTS(
 SELECT 1 FROM sb.staff_role_assignments WHERE user_id=sb.user_id() AND active AND (expires_at IS NULL OR expires_at>now()))
$$;
CREATE FUNCTION sb.is_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.is_staff() AND EXISTS(SELECT 1 FROM sb.staff_role_assignments WHERE user_id=sb.user_id() AND role_key='owner' AND active AND (expires_at IS NULL OR expires_at>now()))
$$;
-- Only the BFF may populate this GUC, from a verified GoTrue TOTP AMR claim.
-- aal2 alone is insufficient: an old MFA session cannot change owner authority.
CREATE FUNCTION sb.require_fresh_owner_mfa() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE verified text; verified_epoch numeric; current_epoch numeric;
BEGIN
 IF NOT sb.is_owner() THEN RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501'; END IF;
 verified=current_setting('request.jwt.claim.mfa_verified_at',true);
 IF verified IS NULL OR verified !~ '^[0-9]{1,12}([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Fresh owner MFA required' USING ERRCODE='42501'; END IF;
 verified_epoch=verified::numeric; current_epoch=extract(epoch FROM statement_timestamp());
 IF verified_epoch<current_epoch-300 OR verified_epoch>current_epoch+30 THEN RAISE EXCEPTION 'Fresh owner MFA required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION sb.has_permission(requested text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.is_staff() AND EXISTS(SELECT FROM sb.staff_permissions WHERE key=requested) AND (
 sb.is_owner() OR (requested NOT IN ('security.manage','strategic.manage') AND NOT EXISTS(SELECT FROM sb.staff_permission_overrides WHERE user_id=sb.user_id() AND permission=requested AND effect='deny') AND
 (EXISTS(SELECT FROM sb.staff_permission_overrides WHERE user_id=sb.user_id() AND permission=requested AND effect='allow') OR
 EXISTS(SELECT FROM sb.staff_role_assignments a JOIN sb.staff_role_permissions p ON p.role_key=a.role_key WHERE a.user_id=sb.user_id() AND a.active AND (a.expires_at IS NULL OR a.expires_at>now()) AND p.permission=requested))))
$$;
CREATE FUNCTION sb.staff_context() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('roles',coalesce((SELECT jsonb_agg(role_key ORDER BY role_key) FROM sb.staff_role_assignments WHERE user_id=sb.user_id() AND active AND (expires_at IS NULL OR expires_at>now()) AND sb.has_staff_grant()),'[]'::jsonb),
 'permissions',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM sb.staff_permissions WHERE sb.has_permission(key)),'[]'::jsonb),
 'owner',sb.is_owner(),'limits',jsonb_build_object('commissionAmount',coalesce((SELECT commission_amount FROM sb.staff_limits WHERE user_id=sb.user_id()),10000),'currency',coalesce((SELECT currency FROM sb.staff_limits WHERE user_id=sb.user_id()),'EUR')))
$$;
CREATE FUNCTION sb.staff_directory() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT sb.has_permission('staff.read') THEN RAISE EXCEPTION 'Staff directory not permitted' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(row_to_json(x)) FROM (
 SELECT a.user_id AS "userId",a.email,a.status,g.active,
 coalesce((SELECT jsonb_agg(role_key ORDER BY role_key) FROM sb.staff_role_assignments WHERE user_id=a.user_id AND active AND (expires_at IS NULL OR expires_at>now())),'[]'::jsonb) AS roles,
 coalesce((SELECT jsonb_agg(jsonb_build_object('role',role_key,'active',active,'expiresAt',expires_at) ORDER BY role_key) FROM sb.staff_role_assignments WHERE user_id=a.user_id),'[]'::jsonb) AS assignments,
 coalesce((SELECT jsonb_agg(jsonb_build_object('permission',permission,'effect',effect) ORDER BY permission) FROM sb.staff_permission_overrides WHERE user_id=a.user_id),'[]'::jsonb) AS overrides,
 jsonb_build_object('commissionAmount',coalesce(l.commission_amount,10000),'currency',coalesce(l.currency,'EUR')) AS limits
 FROM sb.staff_grants g JOIN sb.accounts a ON a.user_id=g.user_id LEFT JOIN sb.staff_limits l ON l.user_id=g.user_id ORDER BY a.created_at,a.user_id LIMIT 200
 ) x),'[]'::jsonb),
 'roles',(SELECT jsonb_agg(jsonb_build_object('key',r.key,'label',r.label,'permissions',(SELECT jsonb_agg(permission ORDER BY permission) FROM sb.staff_role_permissions WHERE role_key=r.key)) ORDER BY r.key) FROM sb.staff_roles r),
 'permissions',(SELECT jsonb_agg(jsonb_build_object('key',key,'ownerControlled',owner_controlled) ORDER BY key) FROM sb.staff_permissions)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION sb.target_is_protected(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM sb.staff_role_assignments WHERE user_id=target AND role_key IN ('owner','general_director') AND active AND (expires_at IS NULL OR expires_at>now()))
$$;
CREATE FUNCTION sb.bootstrap_owner(target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Executable only by a DBA, never by the API/session login. Refuses unverified users.
 IF NOT EXISTS(SELECT FROM sb.accounts WHERE user_id=target AND status='active' AND email_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified active account required' USING ERRCODE='42501'; END IF;
 INSERT INTO sb.staff_grants(user_id,active) VALUES(target,true) ON CONFLICT(user_id) DO UPDATE SET active=true;
 INSERT INTO sb.staff_role_assignments(user_id,role_key,assigned_by) VALUES(target,'owner',target) ON CONFLICT(user_id,role_key) DO UPDATE SET active=true,expires_at=NULL,updated_at=now();
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id) VALUES(target,'owner.bootstrap','sb.staff_role_assignments',target::text);
END $$;
CREATE FUNCTION sb.set_staff_role(target uuid,requested_role text,enabled boolean,expiry timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.has_permission('staff.manage') OR NOT EXISTS(SELECT FROM sb.staff_roles WHERE key=requested_role) OR enabled IS NULL THEN RAISE EXCEPTION 'Role administration not permitted' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM sb.accounts WHERE user_id=target AND status='active' AND email_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified active account required' USING ERRCODE='42501'; END IF;
 IF (requested_role IN ('owner','general_director') OR sb.target_is_protected(target) OR target=sb.user_id()) AND NOT sb.is_owner() THEN RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501'; END IF;
 IF requested_role IN ('owner','general_director') OR sb.target_is_protected(target) OR target=sb.user_id() THEN PERFORM sb.require_fresh_owner_mfa(); END IF;
 IF expiry IS NOT NULL AND (expiry<=now() OR requested_role='owner') THEN RAISE EXCEPTION 'Invalid role expiry' USING ERRCODE='22023'; END IF;
 IF NOT sb.is_owner() AND enabled AND EXISTS(SELECT FROM sb.staff_role_permissions WHERE role_key=requested_role AND NOT sb.has_permission(permission)) THEN RAISE EXCEPTION 'Cannot delegate unavailable permissions' USING ERRCODE='42501'; END IF;
 -- Serialize owner demotions so two concurrent requests cannot remove the last owner.
 LOCK TABLE sb.staff_role_assignments IN SHARE ROW EXCLUSIVE MODE;
 IF requested_role='owner' AND NOT enabled AND EXISTS(SELECT FROM sb.staff_role_assignments WHERE user_id=target AND role_key='owner' AND active) AND NOT EXISTS(
 SELECT FROM sb.staff_role_assignments r JOIN sb.staff_grants g ON g.user_id=r.user_id JOIN sb.accounts a ON a.user_id=r.user_id WHERE r.role_key='owner' AND r.active AND r.user_id<>target AND g.active AND a.status='active' AND a.email_verified_at IS NOT NULL AND (r.expires_at IS NULL OR r.expires_at>now())) THEN RAISE EXCEPTION 'Cannot remove the last active OWNER' USING ERRCODE='42501'; END IF;
 IF enabled THEN INSERT INTO sb.staff_grants(user_id,active) VALUES(target,true) ON CONFLICT(user_id) DO UPDATE SET active=true; END IF;
 INSERT INTO sb.staff_role_assignments(user_id,role_key,active,expires_at,assigned_by) VALUES(target,requested_role,enabled,expiry,sb.user_id())
 ON CONFLICT(user_id,role_key) DO UPDATE SET active=excluded.active,expires_at=excluded.expires_at,assigned_by=excluded.assigned_by,updated_at=now();
END $$;
CREATE FUNCTION sb.set_staff_permission(target uuid,requested text,desired_effect text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.has_permission('staff.manage') OR desired_effect NOT IN ('allow','deny','remove') OR NOT EXISTS(SELECT FROM sb.staff_permissions WHERE key=requested) THEN RAISE EXCEPTION 'Permission administration not permitted' USING ERRCODE='42501'; END IF;
 IF (target=sb.user_id() OR sb.target_is_protected(target) OR EXISTS(SELECT FROM sb.staff_permissions WHERE key=requested AND owner_controlled)) AND NOT sb.is_owner() THEN RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501'; END IF;
 IF target=sb.user_id() OR sb.target_is_protected(target) OR EXISTS(SELECT FROM sb.staff_permissions WHERE key=requested AND owner_controlled) THEN PERFORM sb.require_fresh_owner_mfa(); END IF;
 IF requested IN ('security.manage','strategic.manage') AND desired_effect<>'remove' THEN RAISE EXCEPTION 'Owner security and strategy permissions are non-delegable' USING ERRCODE='42501'; END IF;
 IF NOT sb.is_owner() AND NOT sb.has_permission(requested) THEN RAISE EXCEPTION 'Cannot delegate unavailable permissions' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM sb.staff_grants WHERE user_id=target AND active) OR NOT EXISTS(SELECT FROM sb.staff_role_assignments WHERE user_id=target AND active AND (expires_at IS NULL OR expires_at>now())) THEN RAISE EXCEPTION 'Active assigned staff account required' USING ERRCODE='42501'; END IF;
 IF desired_effect='remove' THEN DELETE FROM sb.staff_permission_overrides WHERE user_id=target AND permission=requested;
 ELSE INSERT INTO sb.staff_permission_overrides(user_id,permission,effect,assigned_by) VALUES(target,requested,desired_effect,sb.user_id()) ON CONFLICT(user_id,permission) DO UPDATE SET effect=excluded.effect,assigned_by=excluded.assigned_by,updated_at=now(); END IF;
END $$;
CREATE FUNCTION sb.set_staff_limit(target uuid,amount numeric,currency_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.is_owner() OR amount IS NULL OR amount<0 OR amount>9999999999999999 OR currency_code !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Owner authorization and valid limit required' USING ERRCODE='42501'; END IF;
 PERFORM sb.require_fresh_owner_mfa();
 INSERT INTO sb.staff_limits(user_id,commission_amount,currency,updated_by) VALUES(target,amount,currency_code,sb.user_id()) ON CONFLICT(user_id) DO UPDATE SET commission_amount=excluded.commission_amount,currency=excluded.currency,updated_by=excluded.updated_by,updated_at=now();
END $$;
CREATE FUNCTION sb.guard_account_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.status IS DISTINCT FROM old.status THEN
 IF NOT sb.has_permission('accounts.suspend') OR (sb.target_is_protected(old.user_id) AND NOT sb.is_owner()) THEN RAISE EXCEPTION 'Account status change not permitted' USING ERRCODE='42501'; END IF;
 IF sb.target_is_protected(old.user_id) THEN PERFORM sb.require_fresh_owner_mfa(); END IF;
 LOCK TABLE sb.staff_role_assignments IN SHARE ROW EXCLUSIVE MODE;
 IF new.status='suspended' AND EXISTS(SELECT FROM sb.staff_role_assignments WHERE user_id=old.user_id AND role_key='owner' AND active) AND NOT EXISTS(
 SELECT FROM sb.staff_role_assignments r JOIN sb.staff_grants g ON g.user_id=r.user_id JOIN sb.accounts a ON a.user_id=r.user_id WHERE r.role_key='owner' AND r.active AND r.user_id<>old.user_id AND g.active AND a.status='active' AND a.email_verified_at IS NOT NULL AND (r.expires_at IS NULL OR r.expires_at>now())) THEN RAISE EXCEPTION 'Cannot suspend the last active OWNER' USING ERRCODE='42501'; END IF;
 IF new.status='suspended' THEN DELETE FROM sb.sessions WHERE user_id=old.user_id; END IF;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER account_status_guard BEFORE UPDATE OF status ON sb.accounts FOR EACH ROW EXECUTE FUNCTION sb.guard_account_status();
CREATE FUNCTION sb.suspend_account(target uuid,desired_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.has_permission('accounts.suspend') OR desired_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Account administration not permitted' USING ERRCODE='42501'; END IF;
 UPDATE sb.accounts SET status=desired_status WHERE user_id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION sb.add_company_member(company uuid,target uuid,requested_role text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE membership uuid;
BEGIN
 IF NOT sb.has_permission('memberships.edit') OR requested_role NOT IN ('buyer','supplier','partner') THEN RAISE EXCEPTION 'Membership administration not permitted' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM sb.accounts WHERE user_id=target AND status='active' AND email_verified_at IS NOT NULL) OR NOT EXISTS(SELECT FROM sb.applications WHERE company_id=company AND requested_role=add_company_member.requested_role AND status='approved') THEN RAISE EXCEPTION 'Approved company and verified active member required' USING ERRCODE='42501'; END IF;
 INSERT INTO sb.memberships(user_id,company_id,role,status) VALUES(target,company,requested_role,'approved') ON CONFLICT(user_id,company_id,role) DO UPDATE SET status='approved' RETURNING id INTO membership;
 RETURN membership;
END $$;

CREATE OR REPLACE FUNCTION sb.owns_company(company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT sb.account_active(false) AND (EXISTS(SELECT FROM sb.companies WHERE id=company AND created_by=sb.user_id()) OR
 (sb.account_active(true) AND EXISTS(SELECT FROM sb.memberships WHERE company_id=company AND user_id=sb.user_id() AND status='approved')))
$$;
CREATE OR REPLACE FUNCTION sb.decide_application(application uuid,decision text,note text DEFAULT '') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item sb.applications;
BEGIN
 IF decision NOT IN ('approved','rejected') OR NOT sb.has_permission(CASE decision WHEN 'approved' THEN 'applications.approve' ELSE 'applications.reject' END) OR note IS NULL OR length(note)>2000 THEN RAISE EXCEPTION 'Application decision not permitted' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM sb.applications WHERE id=application FOR UPDATE;
 IF NOT FOUND OR item.status<>'pending' THEN RAISE EXCEPTION 'Pending application required' USING ERRCODE='22023'; END IF;
 IF decision='approved' AND NOT EXISTS(SELECT FROM sb.accounts WHERE user_id=item.user_id AND status='active' AND email_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified active applicant required' USING ERRCODE='42501'; END IF;
 UPDATE sb.applications SET status=decision,decision_note=note,reviewed_by=sb.user_id(),reviewed_at=now() WHERE id=application;
 UPDATE sb.memberships SET status=CASE decision WHEN 'approved' THEN 'approved' ELSE 'suspended' END WHERE user_id=item.user_id AND company_id=item.company_id AND role=item.requested_role;
END $$;
CREATE OR REPLACE FUNCTION sb.set_membership_status(membership uuid,desired_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.has_permission('memberships.edit') OR desired_status NOT IN ('approved','suspended') THEN RAISE EXCEPTION 'Membership administration not permitted' USING ERRCODE='42501'; END IF;
 IF desired_status='approved' AND NOT EXISTS(SELECT FROM sb.memberships m JOIN sb.applications a ON a.company_id=m.company_id AND a.requested_role=m.role JOIN sb.accounts u ON u.user_id=m.user_id WHERE m.id=membership AND a.status='approved' AND u.email_verified_at IS NOT NULL AND u.status='active') THEN RAISE EXCEPTION 'Approved company and verified active account required' USING ERRCODE='42501'; END IF;
 UPDATE sb.memberships SET status=desired_status WHERE id=membership;
END $$;
CREATE OR REPLACE FUNCTION sb.enforce_business_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resource text; permitted boolean;
BEGIN
 IF new.id<>old.id OR new.public_id<>old.public_id OR new.company_id<>old.company_id OR new.created_by<>old.created_by OR new.created_at<>old.created_at THEN RAISE EXCEPTION 'Record identity is immutable' USING ERRCODE='42501'; END IF;
 resource=CASE tg_table_name WHEN 'offers' THEN 'offers' WHEN 'rfqs' THEN 'rfqs' ELSE 'proposals' END;
 permitted=sb.has_permission(resource||'.edit');
 IF new.status IS DISTINCT FROM old.status THEN
  permitted=CASE WHEN new.status IN ('approved','accepted') THEN sb.has_permission(resource||'.approve') WHEN new.status IN ('rejected','declined') THEN sb.has_permission(resource||'.reject') WHEN resource='offers' AND new.status='archived' THEN sb.has_permission('offers.archive') ELSE sb.has_permission(resource||'.edit') END;
 END IF;
 IF new.data IS DISTINCT FROM old.data AND NOT sb.has_permission(resource||'.edit') THEN permitted=false; END IF;
 IF NOT permitted AND NOT (old.created_by=sb.user_id() AND old.status IN ('draft','clarification_requested') AND new.status IN ('draft','submitted') AND
 sb.has_role(old.company_id,CASE tg_table_name WHEN 'offers' THEN 'supplier' WHEN 'rfqs' THEN 'buyer' ELSE 'partner' END)) THEN RAISE EXCEPTION 'Record action not permitted' USING ERRCODE='42501'; END IF;
 new.updated_at=now();RETURN new;
END $$;
CREATE FUNCTION sb.enforce_business_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resource text;
BEGIN
 resource=CASE tg_table_name WHEN 'offers' THEN 'offers' WHEN 'rfqs' THEN 'rfqs' ELSE 'proposals' END;
 IF new.created_by<>sb.user_id() THEN RAISE EXCEPTION 'Record creator must be the acting user' USING ERRCODE='42501'; END IF;
 IF new.status NOT IN ('draft','submitted') AND NOT sb.has_permission(CASE WHEN new.status IN ('approved','accepted') THEN resource||'.approve' WHEN new.status IN ('rejected','declined') THEN resource||'.reject' WHEN resource='offers' AND new.status='archived' THEN 'offers.archive' ELSE resource||'.edit' END) THEN RAISE EXCEPTION 'Record initial decision not permitted' USING ERRCODE='42501'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER offer_insert_permission BEFORE INSERT ON sb.offers FOR EACH ROW EXECUTE FUNCTION sb.enforce_business_insert();
CREATE TRIGGER rfq_insert_permission BEFORE INSERT ON sb.rfqs FOR EACH ROW EXECUTE FUNCTION sb.enforce_business_insert();
CREATE TRIGGER proposal_insert_permission BEFORE INSERT ON sb.partner_proposals FOR EACH ROW EXECUTE FUNCTION sb.enforce_business_insert();
CREATE FUNCTION sb.enforce_project_action() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF tg_op='UPDATE' AND (new.id<>old.id OR new.public_id<>old.public_id OR new.partner_company_id<>old.partner_company_id OR new.created_at<>old.created_at) THEN RAISE EXCEPTION 'Project identity is immutable' USING ERRCODE='42501'; END IF;
 IF (tg_op='INSERT' OR new.status IS DISTINCT FROM old.status) AND new.status IN ('completed','cancelled') AND NOT sb.has_permission(CASE new.status WHEN 'completed' THEN 'projects.approve' ELSE 'projects.reject' END) THEN RAISE EXCEPTION 'Project decision not permitted' USING ERRCODE='42501'; END IF;
 RETURN new;
END $$;
CREATE TRIGGER project_action BEFORE INSERT OR UPDATE ON sb.projects FOR EACH ROW EXECUTE FUNCTION sb.enforce_project_action();
CREATE OR REPLACE FUNCTION sb.can_access_resource(kind text,resource text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE kind WHEN 'offer' THEN sb.has_permission('offers.read') AND sb.has_permission('counterparties.read') OR EXISTS(SELECT FROM sb.offers WHERE public_id=resource AND sb.has_role(company_id,'supplier'))
 WHEN 'rfq' THEN sb.has_permission('rfqs.read') AND sb.has_permission('counterparties.read') OR EXISTS(SELECT FROM sb.rfqs WHERE public_id=resource AND sb.has_role(company_id,'buyer'))
 WHEN 'proposal' THEN sb.has_permission('proposals.read') AND sb.has_permission('counterparties.read') OR EXISTS(SELECT FROM sb.partner_proposals WHERE public_id=resource AND sb.has_role(company_id,'partner'))
 WHEN 'opportunity' THEN sb.has_permission('opportunities.read') OR sb.can_view_opportunity(resource) ELSE false END
$$;
CREATE OR REPLACE FUNCTION sb.can_access_message(kind text,resource text,recipient_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE kind
 WHEN 'opportunity' THEN EXISTS(SELECT FROM portal.opportunities WHERE public_id=resource) AND (sb.has_permission('messages.read') AND sb.has_permission('counterparties.read') OR EXISTS(SELECT FROM sb.opportunity_grants g JOIN portal.opportunities p ON p.public_id=g.public_id WHERE g.public_id=resource AND g.company_id=recipient_company AND g.active AND (g.expires_at IS NULL OR g.expires_at>now()) AND p.status='approved' AND sb.has_role(g.company_id,g.role)))
 WHEN 'offer' THEN EXISTS(SELECT FROM sb.offers WHERE public_id=resource AND company_id=recipient_company AND (sb.has_permission('messages.read') AND sb.has_permission('offers.read') AND sb.has_permission('counterparties.read') OR sb.has_role(company_id,'supplier')))
 WHEN 'rfq' THEN EXISTS(SELECT FROM sb.rfqs WHERE public_id=resource AND company_id=recipient_company AND (sb.has_permission('messages.read') AND sb.has_permission('rfqs.read') AND sb.has_permission('counterparties.read') OR sb.has_role(company_id,'buyer')))
 WHEN 'proposal' THEN EXISTS(SELECT FROM sb.partner_proposals WHERE public_id=resource AND company_id=recipient_company AND (sb.has_permission('messages.read') AND sb.has_permission('proposals.read') AND sb.has_permission('counterparties.read') OR sb.has_role(company_id,'partner'))) ELSE false END
$$;
-- Retain the reviewed-card validation from migration002 and add a mandatory
-- permission gate; no raw internal offer is copied to the anonymous projection.
ALTER FUNCTION sb.publish_opportunity(uuid,jsonb) RENAME TO publish_opportunity_internal;
REVOKE ALL ON FUNCTION sb.publish_opportunity_internal(uuid,jsonb) FROM shadowbridge_api;
CREATE FUNCTION sb.publish_opportunity(source_offer uuid,sanitized_data jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.has_permission('opportunities.create') OR NOT sb.has_permission('opportunities.approve') THEN RAISE EXCEPTION 'Anonymous publication not permitted' USING ERRCODE='42501'; END IF;
 RETURN sb.publish_opportunity_internal(source_offer,sanitized_data);
END $$;
ALTER FUNCTION sb.grant_opportunity(text,uuid,text,timestamptz) RENAME TO grant_opportunity_internal;
REVOKE ALL ON FUNCTION sb.grant_opportunity_internal(text,uuid,text,timestamptz) FROM shadowbridge_api;
CREATE FUNCTION sb.grant_opportunity(opportunity text,company uuid,requested_role text,expiry timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.has_permission('opportunities.share') THEN RAISE EXCEPTION 'Opportunity sharing not permitted' USING ERRCODE='42501'; END IF;
 PERFORM sb.grant_opportunity_internal(opportunity,company,requested_role,expiry);
END $$;

CREATE FUNCTION sb.commission_risk_payload(requested_action text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF requested_action NOT IN ('commissions.create','commissions.edit') OR jsonb_typeof(payload)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('id','projectId','partnerCompanyId','amount','currency','agreementReference','status')) THEN RAISE EXCEPTION 'Invalid commission approval payload' USING ERRCODE='22023'; END IF;
 result=jsonb_build_object('projectId',(payload->>'projectId')::uuid,'partnerCompanyId',(payload->>'partnerCompanyId')::uuid,'amount',(payload->>'amount')::numeric(18,2),'currency',payload->>'currency','agreementReference',coalesce(payload->>'agreementReference',''),'status',coalesce(payload->>'status','under_agreement'));
 IF requested_action='commissions.edit' THEN result=result||jsonb_build_object('id',(payload->>'id')::uuid); END IF;
 IF result->>'projectId' IS NULL OR result->>'partnerCompanyId' IS NULL OR result->>'amount' IS NULL OR result->>'amount' IN ('NaN','Infinity','-Infinity') OR (result->>'amount')::numeric<0 OR result->>'currency' IS NULL OR result->>'currency' !~ '^[A-Z]{3}$' OR requested_action='commissions.edit' AND result->>'id' IS NULL THEN RAISE EXCEPTION 'Incomplete commission approval payload' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION sb.request_risk_approval(requested_action text,payload jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE approval uuid;amount numeric;currency_code text;
BEGIN
 IF requested_action NOT IN ('commissions.create','commissions.edit') OR NOT sb.has_permission(requested_action) OR jsonb_typeof(payload)<>'object' OR payload->>'amount' IS NULL OR payload->>'currency' !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Risk request not permitted' USING ERRCODE='42501'; END IF;
 payload=sb.commission_risk_payload(requested_action,payload);
 amount=(payload->>'amount')::numeric;currency_code=payload->>'currency';
 IF amount<0 THEN RAISE EXCEPTION 'Invalid amount' USING ERRCODE='22023'; END IF;
 INSERT INTO sb.risk_approvals(requested_by,action,payload_hash,amount,currency) VALUES(sb.user_id(),requested_action,encode(public.digest(payload::text,'sha256'),'hex'),amount,currency_code) RETURNING id INTO approval;
 RETURN approval;
END $$;
CREATE FUNCTION sb.decide_risk_approval(approval uuid,decision text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT sb.is_owner() OR decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501'; END IF;
 PERFORM sb.require_fresh_owner_mfa();
 UPDATE sb.risk_approvals SET status=decision,reviewed_by=sb.user_id(),reviewed_at=now() WHERE id=approval AND requested_by<>sb.user_id() AND status='pending' AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'Another actor and pending unexpired approval required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION sb.enforce_commission_action() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE requested_action text;limit_amount numeric;limit_currency text;payload jsonb;approval uuid;
BEGIN
 requested_action=CASE tg_op WHEN 'INSERT' THEN 'commissions.create' ELSE 'commissions.edit' END;
 IF NOT sb.has_permission(requested_action) THEN RAISE EXCEPTION 'Commission action not permitted' USING ERRCODE='42501'; END IF;
 IF new.amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Finite commission amount required' USING ERRCODE='22023'; END IF;
 IF tg_op='UPDATE' AND (new.id<>old.id OR new.project_id<>old.project_id OR new.partner_company_id<>old.partner_company_id OR new.created_at<>old.created_at) THEN RAISE EXCEPTION 'Commission identity is immutable' USING ERRCODE='42501'; END IF;
 IF (tg_op='UPDATE' AND new.status IS DISTINCT FROM old.status OR tg_op='INSERT' AND new.status<>'under_agreement') AND NOT sb.has_permission(CASE WHEN new.status='cancelled' THEN 'commissions.reject' ELSE 'commissions.approve' END) THEN RAISE EXCEPTION 'Commission decision not permitted' USING ERRCODE='42501'; END IF;
 IF new.amount IS NOT NULL THEN
 SELECT commission_amount,currency INTO limit_amount,limit_currency FROM sb.staff_limits WHERE user_id=sb.user_id();
 limit_amount=coalesce(limit_amount,10000);limit_currency=coalesce(limit_currency,'EUR');
 IF new.amount>limit_amount OR new.currency IS DISTINCT FROM limit_currency THEN
 IF sb.is_owner() THEN
  -- Ultimate owner authority still requires a recent TOTP proof for high risk.
  PERFORM sb.require_fresh_owner_mfa();
 ELSE
 payload=jsonb_build_object('projectId',new.project_id,'partnerCompanyId',new.partner_company_id,'amount',new.amount,'currency',new.currency,'agreementReference',coalesce(new.agreement_reference,''),'status',new.status);
 IF tg_op='UPDATE' THEN payload=payload||jsonb_build_object('id',new.id); END IF;
 -- Canonicalize UUIDs, optional defaults and numeric scale on BOTH paths.
 payload=sb.commission_risk_payload(requested_action,payload);
 approval=nullif(current_setting('request.risk_approval_id',true),'')::uuid;
 UPDATE sb.risk_approvals SET status='consumed',consumed_at=now() WHERE id=approval AND requested_by=sb.user_id() AND action=requested_action AND status='approved' AND expires_at>now() AND payload_hash=encode(public.digest(payload::text,'sha256'),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'Additional owner authorization required for commission limit or currency' USING ERRCODE='42501'; END IF;
 END IF; -- owner freshness versus independently approved non-owner action
 END IF; -- amount or currency outside limits
 END IF; -- disclosed monetary amount
 RETURN new;
END $$;
CREATE TRIGGER commission_action BEFORE INSERT OR UPDATE ON sb.commissions FOR EACH ROW EXECUTE FUNCTION sb.enforce_commission_action();
CREATE FUNCTION sb.rbac_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;previous jsonb;
BEGIN
 item=CASE WHEN tg_op='DELETE' THEN to_jsonb(old) ELSE to_jsonb(new) END;
 previous=CASE WHEN tg_op IN ('DELETE','UPDATE') THEN to_jsonb(old) ELSE '{}'::jsonb END;
 INSERT INTO sb.audit_events(actor_id,action,resource,resource_id,metadata) VALUES(sb.user_id(),lower(tg_op),'sb.'||tg_table_name,coalesce(item->>'id',item->>'user_id'),
 jsonb_strip_nulls(jsonb_build_object('role',item->>'role_key','permission',item->>'permission','effect',item->>'effect','active',item->'active','status',item->>'status','previousStatus',previous->>'status','previousActive',previous->'active','commissionLimit',item->'commission_amount','currency',item->>'currency','previousEffect',previous->>'effect','expiresAt',item->>'expires_at','previousExpiresAt',previous->>'expires_at','assignedBy',item->>'assigned_by')));
 RETURN CASE WHEN tg_op='DELETE' THEN old ELSE new END;
END $$;

-- Replace every legacy all-staff policy, including the intake queue.
DROP POLICY account_select ON sb.accounts;DROP POLICY account_staff_update ON sb.accounts;
CREATE POLICY account_select ON sb.accounts FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() OR sb.has_permission('accounts.read') OR sb.has_permission('staff.read') AND EXISTS(SELECT FROM sb.staff_grants WHERE user_id=accounts.user_id AND active));
CREATE POLICY account_staff_update ON sb.accounts FOR UPDATE TO shadowbridge_api USING(sb.has_permission('accounts.suspend')) WITH CHECK(sb.has_permission('accounts.suspend'));
DROP POLICY company_select ON sb.companies;
CREATE POLICY company_select ON sb.companies FOR SELECT TO shadowbridge_api USING(sb.owns_company(id) OR sb.has_permission('companies.read') AND sb.has_permission('counterparties.read'));
DROP POLICY application_select ON sb.applications;
CREATE POLICY application_select ON sb.applications FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() AND sb.account_active(false) OR sb.has_permission('applications.read') AND sb.has_permission('counterparties.read'));
DROP POLICY membership_select ON sb.memberships;
CREATE POLICY membership_select ON sb.memberships FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() AND sb.account_active(false) OR sb.has_permission('memberships.read') AND sb.has_permission('counterparties.read'));
DROP POLICY staff_select ON sb.staff_grants;
CREATE POLICY staff_select ON sb.staff_grants FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() OR sb.has_permission('staff.read'));
DROP POLICY profile_select ON sb.professional_profiles;
CREATE POLICY profile_select ON sb.professional_profiles FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() AND sb.account_active(false) OR sb.has_permission('proposals.read') AND sb.has_permission('counterparties.read'));
DO $$ DECLARE tbl text;role_name text;resource text;BEGIN
 FOR tbl,role_name,resource IN VALUES('offers','supplier','offers'),('rfqs','buyer','rfqs'),('partner_proposals','partner','proposals') LOOP
 EXECUTE format('DROP POLICY business_select ON sb.%I',tbl);EXECUTE format('DROP POLICY business_insert ON sb.%I',tbl);EXECUTE format('DROP POLICY business_update ON sb.%I',tbl);
 EXECUTE format('CREATE POLICY business_select ON sb.%I FOR SELECT TO shadowbridge_api USING(sb.has_role(company_id,%L) OR sb.has_permission(%L) AND sb.has_permission(''counterparties.read''))',tbl,role_name,resource||'.read');
 EXECUTE format('CREATE POLICY business_insert ON sb.%I FOR INSERT TO shadowbridge_api WITH CHECK(created_by=sb.user_id() AND sb.has_role(company_id,%L) AND status IN (''draft'',''submitted'') OR sb.has_permission(%L))',tbl,role_name,resource||'.create');
 EXECUTE format('CREATE POLICY business_update ON sb.%I FOR UPDATE TO shadowbridge_api USING(created_by=sb.user_id() AND sb.has_role(company_id,%L) AND status IN (''draft'',''clarification_requested'') OR sb.has_permission(%L) OR sb.has_permission(%L) OR sb.has_permission(%L) OR (%L=''offers'' AND sb.has_permission(''offers.archive''))) WITH CHECK(created_by=sb.user_id() AND sb.has_role(company_id,%L) AND status IN (''draft'',''submitted'') OR sb.has_permission(%L) OR sb.has_permission(%L) OR sb.has_permission(%L) OR (%L=''offers'' AND sb.has_permission(''offers.archive'')))',tbl,role_name,resource||'.edit',resource||'.approve',resource||'.reject',resource,role_name,resource||'.edit',resource||'.approve',resource||'.reject',resource);
 END LOOP;
END $$;
DROP POLICY opportunity_select ON portal.opportunities;DROP POLICY opportunity_staff_update ON portal.opportunities;
CREATE POLICY opportunity_select ON portal.opportunities FOR SELECT TO shadowbridge_api USING(sb.has_permission('opportunities.read') OR sb.can_view_opportunity(public_id));
CREATE POLICY opportunity_staff_update ON portal.opportunities FOR UPDATE TO shadowbridge_api USING(sb.has_permission('opportunities.edit')) WITH CHECK(sb.has_permission('opportunities.edit'));
DROP POLICY source_staff ON sb.opportunity_sources;
CREATE POLICY source_staff ON sb.opportunity_sources FOR SELECT TO shadowbridge_api USING(sb.has_permission('opportunities.read') AND sb.has_permission('counterparties.read'));
DROP POLICY grant_select ON sb.opportunity_grants;DROP POLICY grant_staff_update ON sb.opportunity_grants;
CREATE POLICY grant_select ON sb.opportunity_grants FOR SELECT TO shadowbridge_api USING(sb.has_permission('opportunities.share') AND sb.has_permission('counterparties.read') OR active AND (expires_at IS NULL OR expires_at>now()) AND sb.has_role(company_id,role));
CREATE POLICY grant_staff_update ON sb.opportunity_grants FOR UPDATE TO shadowbridge_api USING(sb.has_permission('opportunities.share')) WITH CHECK(sb.has_permission('opportunities.share'));
DROP POLICY message_insert ON sb.messages;
CREATE POLICY message_insert ON sb.messages FOR INSERT TO shadowbridge_api WITH CHECK(sender_user_id=sb.user_id() AND sb.can_access_message(resource_type,resource_public_id,company_id) AND (NOT sb.is_staff() OR sb.has_permission('messages.create')));
DROP POLICY project_select ON sb.projects;DROP POLICY project_staff_write ON sb.projects;
CREATE POLICY project_select ON sb.projects FOR SELECT TO shadowbridge_api USING(sb.has_permission('projects.read') AND sb.has_permission('counterparties.read') OR sb.has_role(partner_company_id,'partner'));
CREATE POLICY project_create ON sb.projects FOR INSERT TO shadowbridge_api WITH CHECK(sb.has_permission('projects.create'));
CREATE POLICY project_update ON sb.projects FOR UPDATE TO shadowbridge_api USING(sb.has_permission('projects.edit')) WITH CHECK(sb.has_permission('projects.edit'));
DROP POLICY commission_select ON sb.commissions;DROP POLICY commission_staff_write ON sb.commissions;
CREATE POLICY commission_select ON sb.commissions FOR SELECT TO shadowbridge_api USING(sb.has_permission('commissions.read') AND sb.has_permission('counterparties.read') OR sb.has_role(partner_company_id,'partner'));
CREATE POLICY commission_create ON sb.commissions FOR INSERT TO shadowbridge_api WITH CHECK(sb.has_permission('commissions.create'));
CREATE POLICY commission_update ON sb.commissions FOR UPDATE TO shadowbridge_api USING(sb.has_permission('commissions.edit')) WITH CHECK(sb.has_permission('commissions.edit'));
DROP POLICY audit_staff_select ON sb.audit_events;
CREATE POLICY audit_staff_select ON sb.audit_events FOR SELECT TO shadowbridge_api USING(sb.has_permission('audit.read'));
DROP POLICY contact_management_read ON sb.contact_enquiries;DROP POLICY contact_management_status ON sb.contact_enquiries;
CREATE POLICY contact_management_read ON sb.contact_enquiries FOR SELECT TO shadowbridge_api USING(sb.has_permission('contact.read'));
CREATE POLICY contact_management_status ON sb.contact_enquiries FOR UPDATE TO shadowbridge_api USING(sb.has_permission('contact.edit')) WITH CHECK(sb.has_permission('contact.edit'));
-- The legacy trigger also checks is_staff; this new trigger makes edit permission
-- mandatory even when UPDATE is invoked from a privileged application function.
CREATE FUNCTION sb.guard_contact_permission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF NOT sb.has_permission('contact.edit') THEN RAISE EXCEPTION 'Contact editing not permitted' USING ERRCODE='42501'; END IF;RETURN new;END $$;
CREATE TRIGGER contact_permission BEFORE UPDATE ON sb.contact_enquiries FOR EACH ROW EXECUTE FUNCTION sb.guard_contact_permission();

DO $$ DECLARE tbl text;BEGIN
 FOREACH tbl IN ARRAY ARRAY['staff_roles','staff_permissions','staff_role_permissions','staff_role_assignments','staff_permission_overrides','staff_limits','risk_approvals'] LOOP
 EXECUTE format('ALTER TABLE sb.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE sb.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON sb.%I TO shadowbridge_policy',tbl);
 EXECUTE format('GRANT SELECT ON sb.%I TO shadowbridge_api',tbl);
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['staff_role_assignments','staff_permission_overrides','staff_limits','risk_approvals'] LOOP
 EXECUTE format('CREATE TRIGGER rbac_audit AFTER INSERT OR UPDATE OR DELETE ON sb.%I FOR EACH ROW EXECUTE FUNCTION sb.rbac_audit()',tbl);
 END LOOP;
END $$;
CREATE POLICY roles_read ON sb.staff_roles FOR SELECT TO shadowbridge_api USING(sb.has_permission('staff.read'));
CREATE POLICY permissions_read ON sb.staff_permissions FOR SELECT TO shadowbridge_api USING(sb.has_permission('staff.read'));
CREATE POLICY role_permissions_read ON sb.staff_role_permissions FOR SELECT TO shadowbridge_api USING(sb.has_permission('staff.read'));
CREATE POLICY assignments_read ON sb.staff_role_assignments FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() OR sb.has_permission('staff.read'));
CREATE POLICY overrides_read ON sb.staff_permission_overrides FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() OR sb.has_permission('staff.read'));
CREATE POLICY limits_read ON sb.staff_limits FOR SELECT TO shadowbridge_api USING(user_id=sb.user_id() OR sb.has_permission('staff.read'));
CREATE POLICY risk_read ON sb.risk_approvals FOR SELECT TO shadowbridge_api USING(sb.is_owner() OR requested_by=sb.user_id() AND sb.has_permission(action));
-- Own member sees own membership; company colleagues are never implicitly given
-- another company's records by their email address or a guessed UUID.
DO $$ DECLARE item record;BEGIN
 FOR item IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sb' AND p.proname IN (
 'has_staff_grant','is_staff','is_owner','require_fresh_owner_mfa','has_permission','staff_context','staff_directory','target_is_protected','bootstrap_owner','set_staff_role','set_staff_permission','set_staff_limit','guard_account_status','suspend_account','add_company_member','owns_company','decide_application','set_membership_status','enforce_business_update','enforce_business_insert','enforce_project_action','can_access_resource','can_access_message','publish_opportunity','grant_opportunity','commission_risk_payload','request_risk_approval','decide_risk_approval','enforce_commission_action','rbac_audit','guard_contact_permission') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO shadowbridge_policy',item.signature);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',item.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION sb.bootstrap_owner(uuid),sb.target_is_protected(uuid),sb.guard_account_status(),sb.enforce_commission_action(),sb.enforce_business_insert(),sb.enforce_project_action(),sb.rbac_audit(),sb.guard_contact_permission(),sb.commission_risk_payload(text,jsonb) FROM shadowbridge_api,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION sb.is_owner(),sb.require_fresh_owner_mfa(),sb.has_permission(text),sb.staff_context(),sb.staff_directory(),sb.set_staff_role(uuid,text,boolean,timestamptz),sb.set_staff_permission(uuid,text,text),sb.set_staff_limit(uuid,numeric,text),sb.suspend_account(uuid,text),sb.add_company_member(uuid,uuid,text),sb.publish_opportunity(uuid,jsonb),sb.grant_opportunity(text,uuid,text,timestamptz),sb.request_risk_approval(text,jsonb),sb.decide_risk_approval(uuid,text) TO shadowbridge_api;
COMMIT;
