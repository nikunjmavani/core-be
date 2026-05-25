-- migration-safety: allow create_index_without_concurrently reason="migration runner wraps each migration in a transaction, so CREATE INDEX CONCURRENTLY cannot be used here; partial index is narrow (PENDING active uploads only)"

-- Speeds upload-pending-sweep oldest-first lookups:
--   WHERE status = 'PENDING' AND deleted_at IS NULL AND created_at < $cutoff
--   ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_uploads_pending_created_at
  ON upload.uploads (created_at)
  WHERE status = 'PENDING' AND deleted_at IS NULL;
