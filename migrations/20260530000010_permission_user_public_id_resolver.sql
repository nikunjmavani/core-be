-- Permission resolution (requireOrganizationPermission preHandler) runs the five-table
-- role→permission join under ORG-only context (withOrganizationContext sets
-- app.current_organization_id but NOT app.current_user_id). The previous query joined
-- auth.users to filter by public_id, but auth.users is FORCE-RLS protected by an owner
-- policy keyed on app.current_user_id (20260530000004). With no user context the join
-- returned zero rows under the non-superuser core_be_app role, silently stripping every
-- permission and 403-ing all org PERM-gated routes in production (CI connects as a
-- superuser, so the regression was invisible there).
--
-- Mirror the established pre-context resolver pattern (resolve_user_by_internal_id,
-- resolve_api_key_for_authentication): a narrow SECURITY DEFINER function maps the
-- caller's public_id to the internal id without exposing any auth.users row, so the
-- permission query can filter memberships.user_id directly and drop the auth.users join.

CREATE OR REPLACE FUNCTION auth.resolve_user_id_by_public_id (
  public_id_param TEXT
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id
  FROM auth.users
  WHERE public_id = public_id_param
    AND deleted_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth.resolve_user_id_by_public_id (TEXT) TO core_be_app;
