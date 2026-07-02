-- Server-side member search: resolve the set of an organization's membership ids whose member's
-- user email or name matches a search term. The caller (repository) then applies the existing
-- (created_at, id) keyset + limit over these ids through the normal typed Drizzle query, so row
-- typing, serialization, and pagination stay identical to the non-search path.
--
-- Why a SECURITY DEFINER function: the members list runs under ORG-only context
-- (withOrganizationDatabaseContext sets `app.current_organization_id`, NOT `app.current_user_id`),
-- and `auth.users` is FORCE ROW LEVEL SECURITY behind an owner policy keyed on `app.current_user_id`
-- (20260530000004). A plain join from `tenancy.memberships` to `auth.users` therefore matches ZERO
-- rows under the non-superuser `core_be_app` role (the same trap that silently stripped data in
-- 20260530000010 / 20260603120000 — invisible in CI, which connects as a superuser). This mirrors the
-- established sibling resolvers (auth.resolve_user_summaries_by_ids, 20260620000000): a narrow
-- SECURITY DEFINER function that bypasses RLS by explicit organization scoping.
--
-- Trust model: the function is scoped to `organization_id_param`, which the caller
-- (MembershipService.list) derives from the request's active-organization context AFTER
-- requireOrganizationMembershipByPublicId — the same trusted-caller model as the sibling resolvers.
-- It returns ONLY membership ids for that organization (WHERE m.organization_id = organization_id_param),
-- so there is no cross-organization leak, and it exposes no auth.users columns. The search term arrives
-- pre-escaped as a LIKE pattern (`%term%`, wildcards backslash-escaped by the repository) and is matched
-- with the default ESCAPE '\'.

CREATE OR REPLACE FUNCTION tenancy.search_organization_membership_ids (
  organization_id_param BIGINT,
  search_pattern_param TEXT
) RETURNS TABLE (id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenancy, auth, public
AS $$
  SELECT membership_row.id
  FROM tenancy.memberships AS membership_row
  JOIN auth.users AS user_row ON user_row.id = membership_row.user_id
  WHERE membership_row.organization_id = organization_id_param
    AND membership_row.deleted_at IS NULL
    AND (
      user_row.email ILIKE search_pattern_param
      OR user_row.first_name ILIKE search_pattern_param
      OR user_row.last_name ILIKE search_pattern_param
      OR (coalesce(user_row.first_name, '') || ' ' || coalesce(user_row.last_name, ''))
        ILIKE search_pattern_param
    );
$$;

GRANT EXECUTE ON FUNCTION tenancy.search_organization_membership_ids (BIGINT, TEXT) TO core_be_app;
