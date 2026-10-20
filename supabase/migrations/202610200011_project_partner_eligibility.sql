-- Regression: Operations may create projects without broad account-read rights.
-- Eligibility is checked inside a narrowly authorized boolean-only function.
BEGIN;
CREATE FUNCTION sb.project_partner_eligible(company uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF sb.has_permission('projects.create') IS NOT TRUE THEN
  RAISE EXCEPTION 'Project creation permission required' USING ERRCODE='42501';
 END IF;
 RETURN EXISTS(
  SELECT FROM sb.memberships m JOIN sb.accounts a ON a.user_id=m.user_id
  WHERE m.company_id=company AND m.role='partner' AND m.status='approved'
   AND a.status='active' AND a.email_verified_at IS NOT NULL
 );
END $$;
GRANT CREATE ON SCHEMA sb TO shadowbridge_policy;
ALTER FUNCTION sb.project_partner_eligible(uuid) OWNER TO shadowbridge_policy;
REVOKE CREATE ON SCHEMA sb FROM shadowbridge_policy;
REVOKE ALL ON FUNCTION sb.project_partner_eligible(uuid) FROM PUBLIC,shadowbridge_sessions;
GRANT EXECUTE ON FUNCTION sb.project_partner_eligible(uuid) TO shadowbridge_api;

-- The same rule protects direct SQL under the restricted application role.
ALTER POLICY project_create ON sb.projects WITH CHECK(
 sb.has_permission('projects.create') AND sb.project_partner_eligible(partner_company_id)
);
COMMIT;
