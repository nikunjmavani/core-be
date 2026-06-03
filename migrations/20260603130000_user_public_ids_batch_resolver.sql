-- Batch reverse resolver: map a set of internal user ids to their public ids.
--
-- The membership list/get serializer must emit external user PUBLIC ids, not the internal
-- bigserial `user_id`. But those reads run under ORG-only context (withOrganizationDatabaseContext
-- sets `app.current_organization_id`, NOT `app.current_user_id`), and `auth.users` is FORCE ROW
-- LEVEL SECURITY behind an owner policy keyed on `app.current_user_id` (20260530000004). A plain
-- join to `auth.users` therefore matches ZERO rows under the non-superuser `core_be_app` role
-- (the exact trap that silently stripped permissions in 20260530000010 and disabled org-mandated
-- MFA in 20260603120000 — invisible in CI, which connects as a superuser).
--
-- Mirror the established pattern (auth.resolve_user_by_internal_id / resolve_user_id_by_public_id):
-- a narrow SECURITY DEFINER function that bypasses RLS by ownership. Array input avoids an N+1 per
-- list page; it exposes ONLY (id, public_id) — no other auth.users columns.

CREATE OR REPLACE FUNCTION auth.resolve_user_public_ids_by_ids (
  user_ids_param BIGINT[]
) RETURNS TABLE (id BIGINT, public_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  -- No deleted_at filter (mirrors auth.resolve_user_by_internal_id): a membership references its
  -- user by internal id and must always resolve to that user's public id, even if soft-deleted.
  SELECT user_row.id, user_row.public_id::text
  FROM auth.users AS user_row
  WHERE user_row.id = ANY (user_ids_param);
$$;

GRANT EXECUTE ON FUNCTION auth.resolve_user_public_ids_by_ids (BIGINT[]) TO core_be_app;
