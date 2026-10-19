-- Preserve applied migration006. Qualify the company-member RPC columns and parameters.
BEGIN;
CREATE OR REPLACE FUNCTION sb.add_company_member(company uuid,target uuid,requested_role text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE membership uuid;
BEGIN
 IF NOT sb.has_permission('memberships.edit') OR requested_role NOT IN ('buyer','supplier','partner') THEN RAISE EXCEPTION 'Membership administration not permitted' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM sb.accounts a WHERE a.user_id=add_company_member.target AND a.status='active' AND a.email_verified_at IS NOT NULL) OR NOT EXISTS(SELECT FROM sb.applications a WHERE a.company_id=add_company_member.company AND a.requested_role=add_company_member.requested_role AND a.status='approved') THEN RAISE EXCEPTION 'Approved company and verified active member required' USING ERRCODE='42501'; END IF;
 INSERT INTO sb.memberships(user_id,company_id,role,status) VALUES(target,company,requested_role,'approved') ON CONFLICT(user_id,company_id,role) DO UPDATE SET status='approved' RETURNING id INTO membership;
 RETURN membership;
END $$;
ALTER FUNCTION sb.add_company_member(uuid,uuid,text) OWNER TO shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.add_company_member(uuid,uuid,text) FROM PUBLIC,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION sb.add_company_member(uuid,uuid,text) TO shadowbridge_api;
COMMIT;
