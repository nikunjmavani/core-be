-- audit-#2: bounded refresh-token reuse grace.
--
-- Two concurrent legitimate refresh requests using the same current cookie can race: one
-- atomically rotates the stored refresh hash, and the loser then observed a different hash and
-- was misclassified as stolen-token reuse — revoking every session for the user (a remotely
-- triggerable account-wide logout via a double-click / two tabs / proxy retry).
--
-- These columns let the refresh compare-and-swap accept the immediately-previous refresh hash for
-- a short grace window (see REFRESH_TOKEN_REUSE_GRACE_MS) so a concurrent duplicate succeeds, while
-- a replay after the window still falls through to family revocation. RLS for refresh is keyed on
-- app.current_session_public_id, so no policy change is needed for these columns.

ALTER TABLE auth.sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_token_hash varchar(64);

ALTER TABLE auth.sessions
  ADD COLUMN IF NOT EXISTS refresh_token_rotated_at timestamptz;
