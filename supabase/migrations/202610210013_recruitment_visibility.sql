-- Preserve historical policies and data. Application reviewers need the
-- applicant account/profile for the application they are authorized to review,
-- without receiving permission to browse accounts that have not applied.
BEGIN;

DROP POLICY account_select ON sb.accounts;
CREATE POLICY account_select ON sb.accounts FOR SELECT TO shadowbridge_api
USING (
 user_id=sb.user_id()
 OR sb.has_permission('accounts.read')
 OR (
  sb.has_permission('staff.read')
  AND EXISTS(SELECT 1 FROM sb.staff_grants g WHERE g.user_id=accounts.user_id AND g.active)
 )
 OR (
  sb.has_permission('applications.read')
  AND sb.has_permission('counterparties.read')
  AND EXISTS(SELECT 1 FROM sb.applications a WHERE a.user_id=accounts.user_id)
 )
);

DROP POLICY profile_select ON sb.professional_profiles;
CREATE POLICY profile_select ON sb.professional_profiles FOR SELECT TO shadowbridge_api
USING (
 (user_id=sb.user_id() AND sb.account_active(false))
 OR (sb.has_permission('proposals.read') AND sb.has_permission('counterparties.read'))
 OR (
  sb.has_permission('applications.read')
  AND sb.has_permission('counterparties.read')
  AND EXISTS(
   SELECT 1 FROM sb.applications a
   WHERE a.user_id=professional_profiles.user_id
    AND a.company_id=professional_profiles.company_id
  )
 )
);

-- The application policy consults only the current principal through existing
-- SECURITY DEFINER permission/account helpers. It does not select accounts via
-- an invoker query, so the reviewer EXISTS paths do not recurse into this policy.
-- No new table grants, roles, Auth reads, write permissions or data changes.
COMMIT;
