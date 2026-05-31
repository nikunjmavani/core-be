/** Time-to-live and expiry values (seconds, minutes, hours) used across domains. */

/** Milliseconds in one second. */
export const MILLISECONDS_PER_SECOND = 1_000;

/** Milliseconds in one minute. */
export const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;

/** Milliseconds in one hour. */
export const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

/** Seconds in one calendar day. */
export const SECONDS_PER_DAY = 86_400;

/** Milliseconds in one calendar day. */
export const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * MILLISECONDS_PER_SECOND;

/** Five seconds in milliseconds (metrics poll, shutdown buffer). */
export const FIVE_SECONDS_MS = 5_000;

/** Ten seconds in milliseconds (outbound HTTP timeouts, webhook retry base delay). */
export const TEN_SECONDS_MS = 10_000;

/** Fifteen seconds in milliseconds (mail enqueue deadline, graceful shutdown). */
export const FIFTEEN_SECONDS_MS = 15_000;

/** Thirty seconds in milliseconds (DB statement timeout, worker lock duration). */
export const THIRTY_SECONDS_MS = 30_000;

/** JWT access token lifetime (seconds). */
export const ACCESS_TOKEN_EXPIRY_SECONDS = 900;

/** Positive Redis cache TTL after a valid session token lookup (seconds). */
export const SESSION_TOKEN_CACHE_TTL_SECONDS = 60;

/** Idempotency in-flight placeholder TTL before the real response is cached (seconds). */
export const IDEMPOTENCY_PLACEHOLDER_TTL_SECONDS = SESSION_TOKEN_CACHE_TTL_SECONDS;

/** Cached idempotent HTTP response TTL (seconds). */
export const IDEMPOTENCY_RESPONSE_CACHE_TTL_SECONDS = SECONDS_PER_DAY;

/**
 * `Retry-After` advertised on the idempotency-store-unavailable 503 (seconds). Kept short
 * so well-behaved clients retry quickly once a transient Redis blip clears, instead of
 * treating the degraded response as a hard failure.
 */
export const IDEMPOTENCY_STORE_UNAVAILABLE_RETRY_AFTER_SECONDS = 2;

/** MFA challenge session lifetime in Redis (seconds). */
export const MFA_SESSION_TTL_SECONDS = 300;

/**
 * Window during which a successfully consumed TOTP code is remembered in Redis
 * to reject replay (seconds). Covers the current 30-second step plus the
 * ±1-step verification tolerance, so a captured code cannot be reused while it
 * is still cryptographically valid.
 */
export const MFA_TOTP_CODE_REPLAY_TTL_SECONDS = 90;

/** WebAuthn ceremony challenge lifetime in Redis (seconds). */
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = MFA_SESSION_TTL_SECONDS;

/** OAuth CSRF state parameter lifetime in Redis (seconds). */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** Default permission set cache TTL in Redis (seconds). */
export const PERMISSION_CACHE_DEFAULT_TTL_SECONDS = MFA_SESSION_TTL_SECONDS;

/** SETNX lock TTL while recomputing permissions (seconds). */
export const PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS = 15;

/** Worker queue last-job heartbeat key TTL in Redis (seconds). */
export const WORKER_QUEUE_HEARTBEAT_TTL_SECONDS = SECONDS_PER_DAY;

/**
 * Lifetime of the per-notification email-dispatch idempotency marker in Redis (seconds).
 * Must comfortably exceed the notification queue's retry/backoff window so a retried job
 * never re-sends an email that a prior attempt already enqueued.
 */
export const NOTIFICATION_EMAIL_DISPATCH_IDEMPOTENCY_TTL_SECONDS = SECONDS_PER_DAY;

/** Browser CORS preflight cache max-age (seconds). */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = SECONDS_PER_DAY;

/** Magic-link verification token lifetime (minutes). */
export const MAGIC_LINK_EXPIRES_IN_MINUTES = 15;

/** Password-reset verification token lifetime (minutes). */
export const PASSWORD_RESET_EXPIRES_IN_MINUTES = 60;

/** Email-verification token lifetime (hours). */
export const EMAIL_VERIFICATION_EXPIRES_IN_HOURS = 24;

/** Public catalog HTTP Cache-Control max-age (seconds); aligns with permission cache TTL. */
export const CATALOG_CACHE_MAX_AGE_SECONDS = PERMISSION_CACHE_DEFAULT_TTL_SECONDS;

/** Public catalog stale-while-revalidate window (seconds). */
export const CATALOG_CACHE_STALE_WHILE_REVALIDATE_SECONDS = SESSION_TOKEN_CACHE_TTL_SECONDS;

/** Aggregate readiness probe budget per dependency (milliseconds). */
export const HEALTH_READINESS_PROBE_TIMEOUT_MS = 1_500;

/**
 * Window during which a dependency readiness result is reused before re-probing
 * (milliseconds). Bounds probe load from deploy gating and external pollers
 * while staying small enough that a genuine outage surfaces within ~2 seconds.
 */
export const HEALTH_READINESS_PROBE_CACHE_TTL_MS = 2_000;

/** S3 presigned URL lifetime (seconds); aligns with access token TTL. */
export const PRESIGNED_URL_EXPIRY_SECONDS = ACCESS_TOKEN_EXPIRY_SECONDS;

/** GDPR user data export download URL lifetime (seconds); max 24 hours. */
export const USER_DATA_EXPORT_PRESIGNED_DOWNLOAD_EXPIRY_SECONDS = SECONDS_PER_DAY;

/** BullMQ default worker lock duration (milliseconds). */
export const BULLMQ_DEFAULT_LOCK_DURATION_MS = THIRTY_SECONDS_MS;

/** BullMQ stalled-job check interval (milliseconds). */
export const BULLMQ_STALLED_INTERVAL_MS = THIRTY_SECONDS_MS;

/** BullMQ webhook delivery lock duration (milliseconds). */
export const BULLMQ_WEBHOOK_LOCK_DURATION_MS = 60_000;

/** BullMQ retention worker lock duration (milliseconds). */
export const BULLMQ_RETENTION_LOCK_DURATION_MS = 120_000;
