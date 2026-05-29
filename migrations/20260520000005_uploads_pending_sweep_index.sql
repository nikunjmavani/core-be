-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY avoids the SHARE lock that blocks writes during the index build"

-- Speeds upload-pending-sweep oldest-first lookups:
--   WHERE status = 'PENDING' AND deleted_at IS NULL AND created_at < $cutoff
--   ORDER BY created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_uploads_pending_created_at
  ON upload.uploads (created_at)
  WHERE status = 'PENDING' AND deleted_at IS NULL;
