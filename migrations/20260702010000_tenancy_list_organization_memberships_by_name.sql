-- Server-side member SORT by name: return one org's membership ids ORDERED by the member's
-- `auth.users` display name, keyset-paginated, so the members list can be sorted server-side to
-- parity with the roles / api-key lists. The caller (repository) fetches typed `MembershipRow`s by
-- `id IN (...)` and reorders them to the ids returned here, so row typing, serialization, and the
-- opaque cursor stay identical to the other sort paths.
--
-- Why a SECURITY DEFINER function (same rationale as the sibling search resolver,
-- 20260702000000): the members list runs under ORG-only context (withOrganizationDatabaseContext
-- sets `app.current_organization_id`, NOT `app.current_user_id`), and `auth.users` is FORCE ROW
-- LEVEL SECURITY behind an owner policy keyed on `app.current_user_id` (20260530000004). A plain
-- join from `tenancy.memberships` to `auth.users` therefore matches ZERO rows under the
-- non-superuser `core_be_app` role (invisible in CI, which connects as a superuser). Ordering by a
-- name that lives on `auth.users` must therefore happen INSIDE a definer function that bypasses RLS
-- by explicit organization scoping and exposes no `auth.users` columns beyond a derived sort key.
--
-- Trust model: scoped to `organization_id_param`, which the caller (MembershipService.list) derives
-- from the request's active-organization context AFTER requireOrganizationMembershipByPublicId —
-- the same trusted-caller model as the sibling resolvers. It returns ONLY membership ids for that
-- organization (no cross-organization leak) plus the derived `sort_value` (the lower-cased display
-- name used for ordering, which the repository embeds in the opaque cursor). The optional search
-- term arrives pre-escaped as a LIKE pattern (`%term%`, wildcards backslash-escaped by the
-- repository) and is matched with the default ESCAPE '\'; NULL disables the search filter.
--
-- Pagination: keyset over `(sort_value, id)` — `id` always tie-breaks ASCENDING in both sort
-- directions, matching the shared text keyset builders in pagination.util.ts. `after_*` params are
-- NULL on the first page.

CREATE OR REPLACE FUNCTION tenancy.list_organization_membership_ids_by_name (
  organization_id_param BIGINT,
  search_pattern_param TEXT,
  order_desc_param BOOLEAN,
  after_sort_value_param TEXT,
  after_id_param BIGINT,
  limit_param INT
) RETURNS TABLE (id BIGINT, sort_value TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenancy, auth, public
AS $$
  WITH candidate AS (
    SELECT
      membership_row.id AS id,
      lower(
        coalesce(
          nullif(
            trim(coalesce(user_row.first_name, '') || ' ' || coalesce(user_row.last_name, '')),
            ''
          ),
          user_row.email
        )
      ) AS sort_value
    FROM tenancy.memberships AS membership_row
    JOIN auth.users AS user_row ON user_row.id = membership_row.user_id
    WHERE membership_row.organization_id = organization_id_param
      AND membership_row.deleted_at IS NULL
      AND (
        search_pattern_param IS NULL
        OR user_row.email ILIKE search_pattern_param
        OR user_row.first_name ILIKE search_pattern_param
        OR user_row.last_name ILIKE search_pattern_param
        OR (coalesce(user_row.first_name, '') || ' ' || coalesce(user_row.last_name, ''))
          ILIKE search_pattern_param
      )
  )
  SELECT candidate.id, candidate.sort_value
  FROM candidate
  WHERE
    after_sort_value_param IS NULL
    OR (
      CASE
        WHEN order_desc_param THEN
          candidate.sort_value < after_sort_value_param
          OR (candidate.sort_value = after_sort_value_param AND candidate.id > after_id_param)
        ELSE
          candidate.sort_value > after_sort_value_param
          OR (candidate.sort_value = after_sort_value_param AND candidate.id > after_id_param)
      END
    )
  ORDER BY
    CASE WHEN order_desc_param THEN candidate.sort_value END DESC,
    CASE WHEN NOT order_desc_param THEN candidate.sort_value END ASC,
    candidate.id ASC
  LIMIT limit_param;
$$;

GRANT EXECUTE ON FUNCTION tenancy.list_organization_membership_ids_by_name (
  BIGINT, TEXT, BOOLEAN, TEXT, BIGINT, INT
) TO core_be_app;
