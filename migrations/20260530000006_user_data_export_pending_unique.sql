-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY avoids write-blocking SHARE lock on auth.user_data_exports"

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_user_data_exports_user_pending
ON auth.user_data_exports (user_id)
WHERE status IN ('pending', 'processing');
