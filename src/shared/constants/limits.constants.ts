/** Request, export, and worker batch size limits shared across domains. */

/** Maximum idempotent HTTP response body size cached in Redis (bytes). */
export const IDEMPOTENCY_CACHED_BODY_BYTES = 100 * 1024;

/** Default row batch size for bulk delete helpers (not a duration). */
export const DEFAULT_BATCH_DELETE_ROW_COUNT = 5_000;

/** Default cap for unscoped repository list methods (prevents OOM on hot paths). */
export const DEFAULT_REPOSITORY_LIST_LIMIT = 500;

/** Bounded stale-request scan size for each commit-dispatch recovery pass. */
export const DEFAULT_COMMIT_DISPATCH_RECOVERY_BATCH_SIZE = 50;

/** Poll interval (milliseconds) for permission-cache lock waiters during stampede control. */
export const PERMISSION_CACHE_STAMPEDE_POLL_MS = 50;

/** Maximum rows per table included in GDPR user data export. */
export const GDPR_EXPORT_MAX_ROWS_PER_TABLE = 1_000;

/** Visible prefix length when storing organization API key fingerprints. */
export const ORGANIZATION_API_KEY_PREFIX_DISPLAY_LENGTH = 8;

/** Raw secret byte length for generated organization API keys. */
export const ORGANIZATION_API_KEY_RAW_SECRET_BYTE_LENGTH = 32;
