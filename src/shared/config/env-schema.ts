/**
 * Env Zod schema and key list only. Safe to import from scripts that must not run getEnv()
 * (e.g. sync-env-example). Application code should use env.config.ts for getEnv() and env.
 */
import { validateProductionRedisTopology } from '@/infrastructure/cache/redis-url.parse.util.js';
import { PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';
import { z } from 'zod';

const nodeEnvSchema = z
  .enum(['local', 'development', 'staging', 'production', 'test'])
  .default('local');

const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .string()
    .optional()
    .default(defaultValue)
    .transform((value) => value === 'true' || value === '1');

const MAX_TRUST_PROXY_HOPS = 10;

const trustProxyHopCountSchema = z
  .string()
  .optional()
  .transform((value, context) => {
    const normalizedValue = value?.trim().toLowerCase();
    if (!normalizedValue || normalizedValue === 'false' || normalizedValue === '0') {
      return false;
    }

    const hopCount = Number(normalizedValue);
    if (Number.isInteger(hopCount) && hopCount >= 1 && hopCount <= MAX_TRUST_PROXY_HOPS) {
      return hopCount;
    }

    context.addIssue({
      code: 'custom',
      message:
        'TRUST_PROXY must be false/0 or an integer proxy hop count from 1 to 10; do not use bare true',
    });
    return z.NEVER;
  });

const envSchemaBase = z.object({
  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Fastify HTTP bind address (worker health server also binds here). */
  HTTP_BIND_HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: z.string().min(1).default('info'),
  /** Number of reverse-proxy hops Fastify may trust for X-Forwarded-* headers. */
  TRUST_PROXY: trustProxyHopCountSchema,
  FASTIFY_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  FASTIFY_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /** Fastify request timeout (ms). Default: 30000. */
  FASTIFY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /** Fastify connection timeout (ms). Default: 10000. */
  FASTIFY_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /**
   * Emit a `Server-Timing: app;dur=<ms>` response header carrying total server-side processing
   * time (Fastify's per-request timer). Network-independent latency for load tools (k6, curl) and
   * browser devtools without scraping `/metrics`. Default on; set false to suppress the header.
   */
  HTTP_SERVER_TIMING_ENABLED: booleanString('true'),

  // Database (managed service)
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(), // elevated-privilege user for migrations

  // Redis (managed service)
  REDIS_URL: z.string().min(1),
  /**
   * Dedicated Redis endpoint for BullMQ queues. Recommended in production so a queue
   * backlog (e.g. during a worker outage) cannot exhaust the write-critical cache /
   * idempotency / rate-limit store on REDIS_URL. Defaults to REDIS_URL when unset
   * (single-instance local development).
   */
  REDIS_BULLMQ_URL: z.string().min(1).optional(),
  /**
   * Redis key prefix for cache, idempotency, rate limits, and BullMQ (default `core:<NODE_ENV>:`).
   * Override to isolate environments on a shared Redis cluster.
   */
  REDIS_KEY_PREFIX: z
    .string()
    .max(64)
    .regex(/^[a-zA-Z0-9:_-]+$/)
    .optional(),

  // Auth
  /** Deprecated: unused at runtime (RS256 only). Retained for backward-compatible deploy templates. */
  JWT_SECRET: z.string().min(32).optional(),
  /** RS256 PEM private key. Required in every runtime; NODE_ENV is metadata only. */
  JWT_PRIVATE_KEY: z.string().min(1),
  /** RS256 PEM public key. Required in every runtime; NODE_ENV is metadata only. */
  JWT_PUBLIC_KEY: z.string().min(1),
  /** Key id in JWT header when signing with RS256 (default: `default`). */
  JWT_SIGNING_KID: z.string().min(1).optional().default('default'),
  /**
   * Optional `kid`→PEM verification keyring (JSON object) enabling zero-downtime RS256
   * rotation. When set, a token is verified against the public key whose `kid` matches the
   * token header (current + previous keys during an overlap window). Unset preserves the
   * single `JWT_PUBLIC_KEY` path exactly. Public key material → GitHub Variable.
   */
  JWT_PUBLIC_KEYS: z.string().min(1).optional(),
  /** Comma-separated emails that receive super_admin in JWT on login/refresh (platform ops). */
  GLOBAL_ADMIN_EMAILS: z.string().optional(),
  /** Shorter access-token TTL (seconds) for GLOBAL_ADMIN_EMAILS super_admin JWTs. Default 300 (5 min). */
  GLOBAL_ADMIN_ACCESS_TOKEN_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

  // Session
  AUTH_SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).default(7),
  /** Secure flag for session + CSRF cookies. Set false only for plaintext local loops. */
  COOKIE_SECURE: booleanString('true'),

  // CORS (comma-separated origins; required in every runtime)
  ALLOWED_ORIGINS: z.string().min(1),

  /** WebAuthn RP ID (hostname). Defaults to first ALLOWED_ORIGINS hostname or localhost. */
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  /** WebAuthn relying party display name shown in passkey prompts. */
  WEBAUTHN_RP_NAME: z.string().min(1).optional(),

  // App URLs
  FRONTEND_URL: z.url().optional(),
  API_DOCS_BASE_URL: z.url().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  /** Comma-separated hostnames allowed for outbound webhooks (optional; empty = no extra restriction). */
  WEBHOOK_URL_ALLOWLIST: z.string().optional(),
  /**
   * Per-organization cap on active webhook subscribers (sec-N4). The service
   * rejects further creates beyond this number with a 409. The fan-out loop
   * uses the same value as a defense-in-depth backstop so a drift between
   * create-cap and runtime list cannot turn one event into an unbounded
   * signed-POST amplifier.
   */
  WEBHOOK_MAX_PER_ORG: z.coerce.number().int().min(1).max(1000).default(25),
  /**
   * Window (hours) during which outbound webhook deliveries dual-sign with
   * the previous secret too (sec-N8). After this window the worker stops
   * sending `X-Webhook-Signature-Previous`. Default 24h covers a one-day
   * verifier rollout for most customers.
   */
  WEBHOOK_SECRET_ROTATION_OVERLAP_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  // Email (Resend)
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Outbound Resend API request timeout (ms). Forwarded to fetch via AbortSignal. */
  RESEND_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180_000).default(30_000),
  EMAIL_FROM_ADDRESS: z.email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).optional(),
  // Block disposable/temporary email domains (default true). Set to false to allow (e.g. for testing).
  BLOCK_DISPOSABLE_EMAIL: z
    .string()
    .optional()
    .default('true')
    .transform((value) => value !== 'false' && value !== '0'),

  // OAuth
  OAUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_GOOGLE_REDIRECT_URI: z.url().optional(),
  OAUTH_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_GITHUB_REDIRECT_URI: z.url().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Stripe Node client per-request HTTP timeout (ms). */
  STRIPE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180_000).default(30_000),

  // Sentry
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  SENTRY_PROFILE_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  /** Always trace transactions at or above this duration (ms); head + tail sampling. */
  SENTRY_SLOW_TRANSACTION_MS: z.coerce.number().int().min(100).max(300_000).default(3000),
  RAILWAY_GIT_COMMIT_SHA: z.string().min(1).optional(),

  /**
   * When true, exposes GET /metrics (Prometheus text format).
   * NODE_ENV is metadata only; disable explicitly with METRICS_ENABLED=false.
   */
  METRICS_ENABLED: booleanString('true'),
  /** Bearer token a Prometheus scraper sends when scraping /metrics. Required when METRICS_ENABLED=true (min 32 chars). */
  METRICS_SCRAPE_TOKEN: z.string().min(32).optional(),
  /** OTLP HTTP traces endpoint base URL (e.g. https://otel.example.com). Appends /v1/traces when omitted. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  /** OpenTelemetry service.name override (defaults: core-be-api / core-be-worker). */
  OTEL_SERVICE_NAME: z.string().min(1).optional(),

  // S3 / Object Storage
  /** Allow image/svg+xml uploads; sanitized with DOMPurify on confirm (default false). */
  UPLOAD_ALLOW_SVG: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  /**
   * Use presigned POST (with an S3-enforced content-length-range) instead of presigned PUT
   * for direct client uploads. On by default; the response carries `uploadMethod` and,
   * for POST, the policy `fields` clients must submit with the file.
   */
  UPLOAD_USE_PRESIGNED_POST: booleanString('true'),
  /**
   * Per-user cap on concurrent PENDING uploads (rows awaiting confirm). Stops a single
   * authenticated user from exhausting storage by repeatedly requesting presigned URLs
   * and never calling confirm. Reconciled lazily by the PENDING sweeper worker. Default 100.
   */
  UPLOAD_MAX_PENDING_PER_USER: z.coerce.number().int().min(1).default(100),
  /**
   * Per-organization cap on concurrent PENDING uploads across ALL members
   * (sec-UP4). Without this, a 200-member org sitting at the per-user cap
   * could mint 20,000 in-flight uploads — ~200 GB per org at the 10 MB
   * default limit. Default 2000 (4× expected 500-member org × 4 in-flight).
   * The PENDING sweeper reconciles eventually.
   */
  UPLOAD_MAX_PENDING_PER_ORGANIZATION: z.coerce.number().int().min(1).max(100_000).default(2_000),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** AWS SDK maxAttempts for S3 (each attempt bounded by service/client timeouts). */
  S3_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  // Ops knobs
  /** BullMQ worker concurrency fallback when per-queue overrides are unset (default 4). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  WORKER_CONCURRENCY_MAIL: z.coerce.number().int().min(1).max(20).optional(),
  WORKER_CONCURRENCY_NOTIFY: z.coerce.number().int().min(1).max(20).optional(),
  WORKER_CONCURRENCY_WEBHOOK: z.coerce.number().int().min(1).max(20).optional(),
  WORKER_CONCURRENCY_STRIPE: z.coerce.number().int().min(1).max(20).optional(),
  /** HTTP port for worker GET /livez, /readyz, and optional /metrics (default 9090). */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9090),
  /** Max age of throughput queue heartbeats before /readyz returns 503 (default 5 min). */
  WORKER_HEALTH_STALL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(300_000),
  /**
   * Comma-separated BullMQ queue families this worker process runs: `mail`, `notify`,
   * `webhook`, `stripe`, `retention`, `observability`, or `all` (default monolithic worker).
   * Use split services in production so each process pool budget matches its registered workers.
   */
  WORKER_QUEUE_FAMILIES: z.string().min(1).default('all'),
  /**
   * @deprecated Superseded by per-queue demand in worker-connection-budget.ts. Kept for
   * backward-compatible env templates; startup no longer enforces this heuristic.
   */
  WORKER_BACKGROUND_POOL_SLOT_RESERVE: z.coerce.number().int().min(0).max(64).default(6),
  /** Postgres pool size per Node process (postgres-js `max`). Not the cluster-wide total. Default 10. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /** Connections reserved for admin, migrations, and monitoring (subtracted from Postgres max_connections). */
  POSTGRES_RESERVED_CONNECTIONS: z.coerce.number().int().min(1).default(10),
  /** Override when SHOW max_connections is unavailable or wrong (e.g. behind pooler). */
  POSTGRES_MAX_CONNECTIONS: z.coerce.number().int().min(1).optional(),
  /** Shorthand: api_replicas + worker_replicas. Used when split counts (API/WORKER) are not set. */
  DEPLOYMENT_TOTAL_REPLICA_COUNT: z.coerce.number().int().min(1).optional(),
  /** API service replica count for the Postgres connection budget. */
  DEPLOYMENT_API_REPLICA_COUNT: z.coerce.number().int().min(1).optional(),
  /** Worker service replica count for the Postgres connection budget. */
  DEPLOYMENT_WORKER_REPLICA_COUNT: z.coerce.number().int().min(1).optional(),
  /** postgres-js `idle_timeout` (seconds). */
  DATABASE_POOL_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).optional(),
  /** postgres-js `connect_timeout` (seconds). */
  DATABASE_POOL_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).optional(),
  /** postgres-js `max_lifetime` (seconds). */
  DATABASE_POOL_MAX_LIFETIME_SECONDS: z.coerce.number().int().min(60).optional(),
  /** Per-connection statement_timeout (ms). Caps runaway queries; 0 disables. Default: 30000. */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).optional(),
  /**
   * Connection-level statement_timeout (ms) for HTTP handlers. Scoped RLS contexts hold
   * checkouts only for the unit-of-work, so this caps runaway autocommit queries. Default: 5000.
   * 0 falls back to `DATABASE_STATEMENT_TIMEOUT_MS`.
   */
  DATABASE_HTTP_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
  /** Per-connection idle_in_transaction_session_timeout (ms). Caps stuck transactions; 0 disables. Default: 30000. */
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).optional(),
  /** Warn when in-process org RLS checkouts reach this fraction of DATABASE_POOL_MAX (default 0.8). */
  DATABASE_POOL_ACTIVE_WARN_RATIO: z.coerce.number().min(0).max(1).default(0.8),
  /** Critical alert when in-process org RLS checkouts reach this fraction of DATABASE_POOL_MAX (default 0.95). */
  DATABASE_POOL_ACTIVE_CRITICAL_RATIO: z.coerce.number().min(0).max(1).default(0.95),
  /** Warn when cluster-wide active connections (pg_stat_activity) reach this fraction of allowed budget. */
  DATABASE_POOL_CLUSTER_WARN_RATIO: z.coerce.number().min(0).max(1).default(0.8),
  /** Critical cluster pool pressure ratio (default 0.95). */
  DATABASE_POOL_CLUSTER_CRITICAL_RATIO: z.coerce.number().min(0).max(1).default(0.95),
  /** Poll interval for pool exhaustion sampling and optional Prometheus gauges (ms). Default: 5000. */
  DATABASE_POOL_ALERT_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(5_000),
  /** Consecutive over-threshold polls before emitting pool exhaustion alerts (default 2). */
  DATABASE_POOL_ALERT_CONSECUTIVE_POLLS: z.coerce.number().int().min(1).max(10).default(2),
  /** Enable Postgres TLS by default. Set false only for plaintext local Docker/test databases. */
  DATABASE_SSL_ENABLED: booleanString('true'),
  /**
   * When true, Postgres client verifies server TLS certificate (strict). Ignored when
   * `DATABASE_URL` uses `sslmode=verify-ca|verify-full` (always strict).
   *
   * @remarks Parses `"true"`/`"1"` as `true` and everything else as `false`. Uses an explicit
   * transform — NOT `z.coerce.boolean()`, which is `Boolean(String)` and silently treats
   * `"false"`/`"0"` as `true` (the same foot-gun as DLQ_AUTO_RETRY_ENABLED — sec-C1).
   */
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1')),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),

  // Data retention (days to keep audit logs / revoked sessions before cleanup)
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  AUTH_SESSION_RETENTION_DAYS: z.coerce.number().int().min(1),
  /** Tombstoned-row TTL before purge workers hard-delete (default avoids mandatory deploy secret). */
  TOMBSTONE_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  /** Terminal Stripe webhook ledger rows older than this are purged (failed rows kept for replay). */
  STRIPE_WEBHOOK_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),

  // BullMQ repeatable jobs (retention / cleanup schedules)
  SCHEDULER_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((value) => value !== 'false' && value !== '0'),
  /** Interpret cron patterns in this IANA timezone; omit for server default. */
  SCHEDULER_TIMEZONE: z.string().min(1).optional(),
  AUDIT_RETENTION_CRON: z.string().min(1).optional(),
  NOTIFICATION_RETENTION_CRON: z.string().min(1).optional(),
  AUTH_SESSION_CLEANUP_CRON: z.string().min(1).optional(),
  STRIPE_WEBHOOK_EVENT_RETENTION_CRON: z.string().min(1).optional(),
  STRIPE_WEBHOOK_EVENT_RECLAIM_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  STRIPE_WEBHOOK_EVENT_RECLAIM_CRON: z.string().min(1).optional(),
  /** Daily audit cold export to S3 (disabled when S3_BUCKET unset). */
  AUDIT_EXPORT_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  AUDIT_EXPORT_S3_PREFIX: z.string().min(1).default('audit/export'),
  AUDIT_EXPORT_BATCH_SIZE: z.coerce.number().int().min(100).max(50_000).default(5_000),
  AUDIT_EXPORT_CRON: z.string().min(1).optional(),
  MAIL_OUTBOX_SWEEP_PENDING_MINUTES: z.coerce.number().int().min(1).default(15),
  /**
   * Minimum age (minutes) before a row stuck in `sending` is reclaimed to
   * `pending`. Must sit comfortably above worst-case Resend delivery time
   * (BullMQ retry/backoff + circuit cooldown) so a still-in-flight send is not
   * reclaimed prematurely; Resend idempotency keys de-duplicate any overlap.
   */
  MAIL_OUTBOX_RECLAIM_SENDING_MINUTES: z.coerce.number().int().min(1).default(30),
  MAIL_OUTBOX_SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  MAIL_OUTBOX_SWEEPER_CRON: z.string().min(1).optional(),
  WEBHOOK_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  ORGANIZATION_NOTIFICATION_POLICY_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  USER_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  ORGANIZATION_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  MEMBERSHIP_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  MEMBER_ROLE_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  ORGANIZATION_API_KEY_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  UPLOAD_TOMBSTONE_RETENTION_CRON: z.string().min(1).optional(),
  /** Cron for the PENDING upload sweeper (auto-confirm matches, hard-delete orphans). */
  UPLOAD_PENDING_SWEEP_CRON: z.string().min(1).optional(),
  /**
   * Extra grace beyond `PRESIGNED_URL_EXPIRY_SECONDS` before a PENDING upload row becomes
   * eligible for sweeping. Prevents reconciling rows whose presigned URL has only just
   * expired and whose client confirm call is still in flight. Default 1 hour.
   */
  UPLOAD_PENDING_SWEEP_GRACE_SECONDS: z.coerce.number().int().min(60).default(3600),

  /** Bounded SCAN cap for idempotency Redis key cardinality sampling (worker). */
  IDEMPOTENCY_CARDINALITY_SCAN_MAX: z.coerce.number().int().min(1).default(200_000),
  IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD: z.coerce.number().int().min(1).default(50_000),
  IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD: z.coerce.number().int().min(1).default(200_000),
  IDEMPOTENCY_CARDINALITY_CRON: z.string().min(1).optional(),

  /** Alert when a dead-letter queue has at least this many waiting + failed jobs. */
  DLQ_DEPTH_WARN_THRESHOLD: z.coerce.number().int().min(1).default(10),
  DLQ_DEPTH_CRON: z.string().min(1).optional(),

  /**
   * When true, the `dlq-auto-retry` sweeper re-enqueues replayable ledger rows after cooldown.
   *
   * @remarks Uses the shared `booleanString('true')` helper so operator-facing kill-switches
   * actually work: `"false"`/`"0"` parses to `false`. Previously used `z.coerce.boolean()`
   * which is `Boolean(String)` and turns every non-empty string (including `"false"`) into
   * `true` — operators trying to disable the sweeper during an incident found it kept firing
   * (sec-C1).
   */
  DLQ_AUTO_RETRY_ENABLED: booleanString('true'),
  /** Maximum automated replays per `audit.dead_letter_jobs` row (Redis counter). */
  DLQ_AUTO_RETRY_MAX_COUNT: z.coerce.number().int().min(0).default(3),
  /** Minimum minutes between failure (or last auto-retry) and the next automated replay. */
  DLQ_AUTO_RETRY_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(30),
  /** Maximum ledger rows inspected per sweeper tick. */
  DLQ_AUTO_RETRY_BATCH_SIZE: z.coerce.number().int().min(1).default(20),
  DLQ_AUTO_RETRY_CRON: z.string().min(1).optional(),

  /**
   * Alert when a single BullMQ source queue's waiting + delayed backlog reaches this many
   * jobs. A growing backlog (e.g. a worker outage) on a shared Redis can fill memory and,
   * with `maxmemory-policy=noeviction`, reject the write-critical store — so the backlog is
   * sampled alongside DLQ depth. See docs/deployment/runbooks/redis-topology.md.
   */
  QUEUE_WAITING_DEPTH_WARN_THRESHOLD: z.coerce.number().int().min(1).default(1000),
  /**
   * Warn / critical `used_memory / maxmemory` ratios for the cache Redis (0–1). The
   * observability tick samples `INFO memory` + `CONFIG GET maxmemory`; a high ratio under
   * `noeviction` means writes (idempotency/rate-limit) are about to start failing.
   * Skipped when Redis reports `maxmemory=0` (unbounded).
   */
  REDIS_MEMORY_WARN_RATIO: z.coerce.number().min(0).max(1).default(0.85),
  REDIS_MEMORY_CRITICAL_RATIO: z.coerce.number().min(0).max(1).default(0.95),
  ENABLE_QUEUE_DASHBOARD: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /**
   * When false, Bull Board mutation APIs return 403; GET remains available.
   * Enable explicitly for trusted local/admin-only environments.
   */
  ENABLE_QUEUE_DASHBOARD_MUTATIONS: booleanString('false'),

  // CAPTCHA (Cloudflare Turnstile on public auth routes)
  /** `turnstile` enforces X-Captcha-Token; `disabled` skips verification. */
  CAPTCHA_PROVIDER: z.enum(['turnstile', 'disabled']).default('disabled'),
  /** Turnstile secret key — required when CAPTCHA_PROVIDER=turnstile. */
  CAPTCHA_SECRET: z.string().min(1).optional(),
  /** Public site key for frontend widget (optional; not used server-side). */
  CAPTCHA_SITE_KEY: z.string().min(1).optional(),
  /**
   * Dev/test only: request header name that bypasses CAPTCHA when value is true/1.
   * Ignored in production.
   */
  CAPTCHA_BYPASS_HEADER: z.string().min(1).optional(),

  // MCP server (Model Context Protocol) at POST /api/v1/mcp — exposes APIs as tools for frontends/agents
  ENABLE_MCP_SERVER: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  ENABLE_API_REFERENCE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  OPENAPI_SPEC_PATH: z.string().min(1).optional(),

  // Response encryption (obfuscation layer — AES-256-GCM; hides JSON from DevTools Network tab)
  ENABLE_RESPONSE_ENCRYPTION: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  RESPONSE_ENCRYPTION_KEY: z.string().length(64).optional(), // 64 hex chars = 32 bytes for AES-256
  /** AES-256-GCM key for MFA/webhook secrets at rest (64 hex chars). Required in every runtime. */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'SECRETS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  /**
   * Optional version→hex keyring (JSON object, e.g. `{"v1":"<hex>","v2":"<hex>"}`) enabling
   * zero-downtime rotation of field-secret encryption keys. Stored values decrypt by their own
   * version prefix; unset preserves the single `SECRETS_ENCRYPTION_KEY` (`v1`) path exactly.
   */
  SECRETS_ENCRYPTION_KEYS: z.string().min(1).optional(),
  /**
   * Field-secret version used when ENCRYPTING new secrets (default `v1`). Decryption always uses
   * the stored value's own version prefix, so this only selects the write key during rotation.
   */
  SECRETS_ENCRYPTION_CURRENT_VERSION: z.enum(['v1', 'v2']).optional().default('v1'),

  // Monthly database restore drill (GitHub Actions only — not loaded by API/worker at runtime)
  /** Neon API key for scheduled monthly PITR restore drill. GitHub Environment secret via `pnpm github:sync`. */
  MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY: z.string().min(1).optional(),

  // Railway deploy (GitHub Actions only — consumed by .github/workflows/reusable-railway-deploy.yml)
  /** Railway project token used by the deploy job to call `railway redeploy`. GitHub Environment secret via `pnpm github:sync`. */
  RAILWAY_TOKEN: z.string().min(1).optional(),
  /** Railway API service ID for the `core-be-api` service (target of `railway redeploy --service`). */
  RAILWAY_SERVICE_ID: z.string().min(1).optional(),
  /** Railway worker service ID for the `core-be-worker` service (target of `railway redeploy --service`). */
  RAILWAY_WORKER_SERVICE_ID: z.string().min(1).optional(),

  // Postman API documentation publishing (GitHub Actions only — consumed by .github/workflows/reusable-openapi-postman-publish.yml and `pnpm docs:upload`)
  /** Postman API key used by `pnpm docs:upload` to push the generated collection. GitHub Environment secret via `pnpm github:sync`. */
  POSTMAN_API_KEY: z.string().min(1).optional(),
  /** Postman workspace ID where the API documentation collection is published. GitHub Environment secret via `pnpm github:sync`. */
  POSTMAN_WORKSPACE_ID: z.string().min(1).optional(),
});

/**
 * Process environment Zod schema. Refines `envSchemaBase` with cross-field invariants
 * (idempotency threshold ordering, METRICS_ENABLED → token, CAPTCHA configuration,
 * production Turnstile requirement, Redis topology, and FRONTEND_URL protocol) so
 * the API/worker boot fails fast on misconfiguration instead of surfacing partial
 * failures at runtime.
 */
export const envSchema = envSchemaBase
  .refine(
    (data) =>
      data.IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD >=
      data.IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD,
    {
      message:
        'IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD must be >= IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD',
      path: ['IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD'],
    },
  )
  .refine((data) => data.REDIS_MEMORY_CRITICAL_RATIO >= data.REDIS_MEMORY_WARN_RATIO, {
    message: 'REDIS_MEMORY_CRITICAL_RATIO must be >= REDIS_MEMORY_WARN_RATIO',
    path: ['REDIS_MEMORY_CRITICAL_RATIO'],
  })
  .refine(
    (data) => {
      if (data.METRICS_ENABLED) {
        return Boolean(data.METRICS_SCRAPE_TOKEN && data.METRICS_SCRAPE_TOKEN.length >= 32);
      }
      return true;
    },
    {
      message: 'When METRICS_ENABLED=true, METRICS_SCRAPE_TOKEN (min 32 chars) is required',
      path: ['METRICS_SCRAPE_TOKEN'],
    },
  )
  .refine(
    (data) => {
      if (data.CAPTCHA_PROVIDER === 'turnstile') {
        return Boolean(data.CAPTCHA_SECRET);
      }
      return true;
    },
    {
      message: 'CAPTCHA_SECRET is required when CAPTCHA_PROVIDER=turnstile',
      path: ['CAPTCHA_SECRET'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production' && data.NODE_ENV !== 'staging') {
        return true;
      }
      return data.CAPTCHA_PROVIDER === 'turnstile' && Boolean(data.CAPTCHA_SECRET);
    },
    {
      message:
        'In production and staging, CAPTCHA_PROVIDER=turnstile and CAPTCHA_SECRET are required on public auth routes',
      path: ['CAPTCHA_PROVIDER'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') {
        return true;
      }
      // Reject placeholder / low-entropy keys (e.g. the all-zero .env.example template) that
      // would silently defeat encryption-at-rest for MFA TOTP seeds and webhook signing secrets.
      // A real `openssl rand -hex 32` key effectively always contains far more than 8 distinct
      // hex digits, while all-zeros / single-character placeholders contain one.
      return new Set(data.SECRETS_ENCRYPTION_KEY.toLowerCase()).size >= 8;
    },
    {
      message:
        'In production, SECRETS_ENCRYPTION_KEY must be a high-entropy 32-byte key (generate with `openssl rand -hex 32`); placeholder/low-entropy values are rejected',
      path: ['SECRETS_ENCRYPTION_KEY'],
    },
  )
  .refine(
    (data) => {
      return validateProductionRedisTopology(data.REDIS_URL, data.REDIS_BULLMQ_URL);
    },
    {
      message:
        'REDIS_BULLMQ_URL, when set, must be a valid redis:// or rediss:// URL (a dedicated BullMQ endpoint is supported; see docs/deployment/runbooks/redis-topology.md)',
      path: ['REDIS_BULLMQ_URL'],
    },
  )
  .refine(
    (data) => {
      /**
       * `FRONTEND_URL` must be a valid http(s) URL whenever it is set. The previous
       * localhost-only restriction for non-production environments existed because
       * the magic-link service inlined the raw token in API responses outside
       * production. That leak has been removed (see `magic-link.service.ts`), so
       * any deployed environment may now use a real public `FRONTEND_URL`.
       */
      if (!data.FRONTEND_URL) {
        return true;
      }
      try {
        const parsed = new URL(data.FRONTEND_URL);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    {
      message: 'FRONTEND_URL must be a valid http(s) URL.',
      path: ['FRONTEND_URL'],
    },
  )
  .refine(
    (data) => {
      const origins = data.ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      // A literal `*` would make CORS reflect any origin and silently defeat the
      // session-cookie Origin/Referer checks — never allow it as an entry.
      if (origins.includes('*')) {
        return false;
      }
      if (data.NODE_ENV !== 'production') {
        return true;
      }
      // In production every origin must be an absolute https:// URL. Plaintext http
      // origins would let cross-site requests ride over an unencrypted channel and
      // weaken the cookie-origin defenses that compare against this allowlist.
      return origins.every((origin) => {
        try {
          return new URL(origin).protocol === 'https:';
        } catch {
          return false;
        }
      });
    },
    {
      message:
        'ALLOWED_ORIGINS must not contain `*`; in production every entry must be an absolute https:// origin.',
      path: ['ALLOWED_ORIGINS'],
    },
  )
  .refine(
    (data) => {
      // When Resend is configured, EMAIL_FROM_ADDRESS must be set explicitly. There is no
      // hardcoded sender fallback: a default `from` on an unverified domain is silently
      // rejected by Resend, so auth mail (magic link, verification, invitations) never arrives.
      if (!data.RESEND_API_KEY) {
        return true;
      }
      return Boolean(data.EMAIL_FROM_ADDRESS);
    },
    {
      message: 'EMAIL_FROM_ADDRESS is required when RESEND_API_KEY is set.',
      path: ['EMAIL_FROM_ADDRESS'],
    },
  )
  .refine(
    (data) => {
      // In production, session + CSRF cookies must carry the Secure attribute so they are
      // never transmitted over plaintext HTTP. COOKIE_SECURE=false is only valid for local
      // plaintext loops (non-production); allowing it in production would expose the session
      // cookie to network interception.
      if (data.NODE_ENV !== 'production') {
        return true;
      }
      return data.COOKIE_SECURE === true;
    },
    {
      message: 'COOKIE_SECURE must be true in production (cookies sent over HTTPS only).',
      path: ['COOKIE_SECURE'],
    },
  )
  .refine(
    (data) => {
      // sec-UP10: presigned PUT has no client-side min-size enforcement, so a
      // zero-byte upload can occupy a row + presigned slot until the sweeper
      // reclaims it. Presigned POST policy carries `content-length-range` that
      // S3 evaluates at upload time, rejecting empty/oversized bodies before
      // they cost anything. Force POST in production; PUT remains available
      // for non-prod testing.
      if (data.NODE_ENV !== 'production') {
        return true;
      }
      return data.UPLOAD_USE_PRESIGNED_POST === true;
    },
    {
      message:
        'UPLOAD_USE_PRESIGNED_POST must be true in production (PUT fallback has no min-size enforcement).',
      path: ['UPLOAD_USE_PRESIGNED_POST'],
    },
  )
  .refine(
    (data) => {
      // PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS is the Redis lock held while a permission
      // cache miss triggers a DB recompute. If the HTTP statement timeout exceeds the lock TTL,
      // the lock can expire before the DB query finishes, causing concurrent waiters to bypass
      // the stampede guard and all hit the database simultaneously.
      // 0 means "no statement timeout" — in that case we cannot enforce a bound.
      if (data.DATABASE_HTTP_STATEMENT_TIMEOUT_MS === 0) {
        return true;
      }
      return (
        data.DATABASE_HTTP_STATEMENT_TIMEOUT_MS <
        PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS * 1_000
      );
    },
    {
      message: `DATABASE_HTTP_STATEMENT_TIMEOUT_MS must be < ${PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS * 1_000} (PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS × 1000) or 0 (disabled). A longer timeout allows the recompute lock to expire mid-query, defeating the cache stampede guard.`,
      path: ['DATABASE_HTTP_STATEMENT_TIMEOUT_MS'],
    },
  );

/** Ordered list of env var names from the schema (for .env.example sync and scripts). */
export const envSchemaKeys = Object.keys(envSchemaBase.shape) as (keyof z.infer<
  typeof envSchema
>)[];

/**
 * Keys whose schema entry has no default and is not marked `.optional()`. These must
 * always be present at runtime — the app Zod-rejects on first request otherwise.
 *
 * Used by `tooling/setup-infra/validate-github-env.ts` to assert deploy-target secrets
 * against the schema instead of treating every uncommented `.env.example` line as
 * required (which would also flag optional integrations like Stripe / OAuth / S3).
 */
export const envSchemaRequiredKeys: readonly string[] = Object.entries(envSchemaBase.shape)
  .filter(([, schema]) => !(schema as z.ZodTypeAny).safeParse(undefined).success)
  .map(([key]) => key);

/**
 * Keys that are syntactically optional in the schema but become effectively required
 * under common runtime conditions enforced by `.refine()` clauses. Tooling surfaces
 * these as warnings (not hard errors) since they depend on other flag values that
 * deploy validators cannot inspect directly (GitHub only exposes secret *names*).
 */
export const envSchemaConditionallyRequiredKeys: ReadonlyArray<{
  readonly key: string;
  readonly condition: string;
}> = [
  {
    key: 'METRICS_SCRAPE_TOKEN',
    condition: 'METRICS_ENABLED=true (schema default; explicit METRICS_ENABLED=false opts out)',
  },
  {
    key: 'CAPTCHA_SECRET',
    condition:
      'CAPTCHA_PROVIDER=turnstile (schema default is `disabled`; required in NODE_ENV=production)',
  },
  {
    key: 'EMAIL_FROM_ADDRESS',
    condition: 'RESEND_API_KEY is set (no hardcoded sender fallback)',
  },
];

/* ---------------------------------------------------------------------------
 * GitHub Secret vs Variable classification
 * ---------------------------------------------------------------------------
 *
 * The classification lives entirely in `.env.example`: every key sits under
 * either the "GitHub Secrets" half (pushed via `gh secret set`) or the
 * "GitHub Variables" half (pushed via `gh api .../variables`). `pnpm github:sync`
 * mirrors that structure into each missing `.env.<environment>`, and then
 * reads the same structure when pushing.
 *
 * When you add a new env var: add it to this schema AND to the correct half
 * of `.env.example`. The `env-schema-add` skill walks through which half +
 * sub-section to pick.
 * --------------------------------------------------------------------------- */
