-- Batch reverse resolver: map a set of internal user ids to a SUMMARY (public id + display fields).
--
-- The membership list/get serializer now embeds each member's user summary (email, name, avatar)
-- so the frontend can render a members table without an N+1 per-row fetch (there is no such route).
-- But those reads run under ORG-only context (withOrganizationDatabaseContext sets
-- `app.current_organization_id`, NOT `app.current_user_id`), and `auth.users` is FORCE ROW LEVEL
-- SECURITY behind an owner policy keyed on `app.current_user_id` (20260530000004). A plain join to
-- `auth.users` therefore matches ZERO rows under the non-superuser `core_be_app` role (the exact
-- trap that silently stripped data in 20260530000010 / 20260603120000 — invisible in CI, which
-- connects as a superuser).
--
-- Mirror the established sibling (auth.resolve_user_public_ids_by_ids, 20260603130000): a narrow
-- SECURITY DEFINER function that bypasses RLS by ownership. Array input avoids an N+1 per list page.
-- Exposes ONLY the columns the members table needs (id, public_id, email, first_name, last_name,
-- avatar_url) — no password hash, status, or other auth.users internals. Callers only ever pass the
-- internal ids of memberships already RLS-scoped to the current organization, so no cross-org leak.

CREATE OR REPLACE FUNCTION auth.resolve_user_summaries_by_ids (
  user_ids_param BIGINT[]
) RETURNS TABLE (
  id BIGINT,
  public_id TEXT,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  -- No deleted_at filter (mirrors auth.resolve_user_public_ids_by_ids): a membership references its
  -- user by internal id and must always resolve, even if the user was soft-deleted.
  SELECT
    user_row.id,
    user_row.public_id::text,
    user_row.email::text,
    user_row.first_name::text,
    user_row.last_name::text,
    user_row.avatar_url::text
  FROM auth.users AS user_row
  WHERE user_row.id = ANY (user_ids_param);
$$;

GRANT EXECUTE ON FUNCTION auth.resolve_user_summaries_by_ids (BIGINT[]) TO core_be_app;
