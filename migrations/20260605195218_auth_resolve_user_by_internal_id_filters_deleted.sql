-- sec-U1: tighten `auth.resolve_user_by_internal_id` to filter out soft-deleted users.
--
-- Before this change, the resolver returned soft-deleted users (deleted_at IS NOT NULL).
-- Combined with verification tokens not being invalidated on soft-delete (also fixed in
-- the same PR), a magic-link / password-reset token issued seconds before deletion could
-- be redeemed to mint a session for the soon-to-be-deleted user. The resolver is now a
-- single hard gate against this: even a token redeemed after soft-delete fails because
-- the resolver returns no row, so the auth flow surfaces an UnauthorizedError.
--
-- The resolver is SECURITY DEFINER (RLS bypass for the pre-auth lookup path) so this is
-- the right place for the deleted_at gate — the runtime role has no other way to filter.

CREATE OR REPLACE FUNCTION auth.resolve_user_by_internal_id (
  id_param BIGINT
) RETURNS SETOF auth.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT *
  FROM auth.users
  WHERE id = id_param
    AND deleted_at IS NULL
  LIMIT 1;
$$;
