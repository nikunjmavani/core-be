-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY avoids write-blocking SHARE lock on auth.auth_methods; backfill UPDATE is idempotent so re-running on partial failure is safe"

-- sec-re-04: enforces "at most one active MFA_TOTP per user" so re-enrollment
-- cannot leave a stale row that login picks via the (previously unordered)
-- `findTotpByUserId(.limit(1))` and uses to reject the user's working codes.
-- The application code now revokes the existing factor before inserting a new
-- one; this index makes the invariant a database guarantee.

-- Backfill: if production already has duplicate active MFA_TOTP rows per user
-- (the bug this fix addresses), revoke all but the most-recently created so
-- the CREATE UNIQUE INDEX below can succeed. The selection mirrors the new
-- `findTotpByUserId` ORDER BY (created_at DESC, id DESC). The UPDATE is
-- idempotent — re-running matches zero rows and is a no-op.
UPDATE auth.auth_methods
SET revoked_at = NOW()
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS row_number
    FROM auth.auth_methods
    WHERE method_type = 'MFA_TOTP'
      AND revoked_at IS NULL
  ) ranked
  WHERE row_number > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uniq_auth_methods_user_active_totp
ON auth.auth_methods (user_id)
WHERE method_type = 'MFA_TOTP' AND revoked_at IS NULL;
