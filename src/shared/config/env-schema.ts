/**
 * Env Zod schema and key list only. Safe to import from scripts that must not run getEnv()
 * (e.g. sync-env-example). Application code should use env.config.ts for getEnv() and env.
 */
import { validateProductionRedisTopology } from '@/infrastructure/cache/redis-url.parse.util.js';
import { z } from 'zod';

const nodeEnvSchema = z
  .enum(['local', 'development', 'staging', 'production', 'test'])
  .default('local');

const envSchemaBase = z.object({
  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: z.string().min(1).default('info'),
  /** When true, Fastify trusts X-Forwarded-* from the reverse proxy (required behind LB). */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  FASTIFY_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  FASTIFY_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /** Fastify request timeout (ms). Default: 30000. */
  FASTIFY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /** Fastify connection timeout (ms). Default: 10000. */
  FASTIFY_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),

  // Database (managed service)
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(), // elevated-privilege user for migrations

  // Redis (managed service)
  REDIS_URL: z.string().min(1),
  /** BullMQ queues — defaults to REDIS_URL when unset. */
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
  JWT_SECRET: z.string().min(32),
  JWT_PRIVATE_KEY: z.string().optional(), // RS256 PEM private key (production)
  JWT_PUBLIC_KEY: z.string().optional(), // RS256 PEM public key (production)
  /** Key id in JWT header when signing with RS256 (default: `default`). */
  JWT_SIGNING_KID: z.string().min(1).optional().default('default'),
  /**
   * Optional JSON map of kid → SPKI PEM for multi-key verify during rotation.
   * When omitted, `JWT_PUBLIC_KEY` is used under `JWT_SIGNING_KID`.
   */
  JWT_PUBLIC_KEYS: z
    .string()
    .optional()
    .transform((value, context) => {
      if (value === undefined || value.trim() === '') {
        return undefined;
      }
      try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          context.addIssue({
            code: 'custom',
            message: 'JWT_PUBLIC_KEYS must be a JSON object of kid → PEM string',
          });
          return z.NEVER;
        }
        const record: Record<string, string> = {};
        for (const [kid, pem] of Object.entries(parsed)) {
          if (typeof pem !== 'string' || pem.trim().length === 0) {
            context.addIssue({
              code: 'custom',
              message: `JWT_PUBLIC_KEYS entry "${kid}" must be a non-empty PEM string`,
            });
            return z.NEVER;
          }
          // eslint-disable-next-line security/detect-object-injection -- kid from Object.entries iteration of parsed JSON.
          record[kid] = pem;
        }
        return record;
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'JWT_PUBLIC_KEYS must be valid JSON',
        });
        return z.NEVER;
      }
    }),
  /** Comma-separated emails that receive super_admin in JWT on login/refresh (platform ops). */
  GLOBAL_ADMIN_EMAILS: z.string().optional(),
  /** Shorter access-token TTL (seconds) for GLOBAL_ADMIN_EMAILS super_admin JWTs. Default 300 (5 min). */
  GLOBAL_ADMIN_ACCESS_TOKEN_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

  // Session
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).default(7),

  // CORS (required in production — comma-separated origins)
  ALLOWED_ORIGINS: z.string().optional(),

  /** WebAuthn RP ID (hostname). Defaults to first ALLOWED_ORIGINS hostname or localhost. */
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  /** WebAuthn relying party display name shown in passkey prompts. */
  WEBAUTHN_RP_NAME: z.string().min(1).optional(),

  // App URLs
  FRONTEND_URL: z.string().url().optional(),
  API_DOCS_BASE_URL: z.string().url().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_ORG_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  /** Comma-separated hostnames allowed for outbound webhooks (optional; empty = no extra restriction). */
  WEBHOOK_URL_ALLOWLIST: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Outbound Resend API request timeout (ms). Forwarded to fetch via AbortSignal. */
  RESEND_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180_000).default(30_000),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
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
  OAUTH_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  OAUTH_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_GITHUB_REDIRECT_URI: z.string().url().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Stripe Node client per-request HTTP timeout (ms). */
  STRIPE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180_000).default(30_000),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  SENTRY_PROFILE_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  /** Always trace transactions at or above this duration (ms); head + tail sampling. */
  SENTRY_SLOW_TRANSACTION_MS: z.coerce.number().int().min(100).max(300_000).default(3000),
  RAILWAY_GIT_COMMIT_SHA: z.string().min(1).optional(),

  /**
   * When true, exposes GET /metrics (Prometheus text format).
   * Defaults to true in production when unset; false otherwise.
   */
  METRICS_ENABLED: z
    .string()
    .optional()
    .default(process.env.NODE_ENV === 'production' ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1'),
  /** Bearer token required for /metrics when METRICS_ENABLED in production (min 32 chars). */
  METRICS_BEARER_TOKEN: z.string().min(32).optional(),
  /** OTLP HTTP traces endpoint base URL (e.g. https://otel.example.com). Appends /v1/traces when omitted. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  /** OpenTelemetry service.name override (defaults: core-be-api / core-be-worker). */
  OTEL_SERVICE_NAME: z.string().min(1).optional(),

  // S3 / Object Storage
  /** Allow image/svg+xml uploads; sanitized with DOMPurify on confirm (default false). */
  UPLOAD_ALLOW_SVG: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
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
  /** HTTP port for worker GET /health/live, /health/worker, and optional /metrics (default 9090). */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9090),
  /** Max age of throughput queue heartbeats before /health/live returns 503 (default 5 min). */
  WORKER_HEALTH_STALL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(300_000),
  DB_MAX: z.coerce.number().int().min(1).optional(),
  /** Connections reserved for admin, migrations, and monitoring (subtracted from Postgres max_connections). */
  POSTGRES_RESERVED_CONNECTIONS: z.coerce.number().int().min(1).default(10),
  /** Override when SHOW max_connections is unavailable or wrong (e.g. behind pooler). */
  POSTGRES_MAX_CONNECTIONS: z.coerce.number().int().min(1).optional(),
  /** API replicas + worker replicas — shorthand when split counts are not set. */
  DEPLOYMENT_PROCESS_COUNT: z.coerce.number().int().min(1).optional(),
  /** API service replica count for connection budget. */
  DEPLOYMENT_API_PROCESS_COUNT: z.coerce.number().int().min(1).optional(),
  /** Worker service replica count for connection budget. */
  DEPLOYMENT_WORKER_PROCESS_COUNT: z.coerce.number().int().min(1).optional(),
  DB_IDLE_TIMEOUT: z.coerce.number().int().min(1).optional(),
  DB_CONNECT_TIMEOUT: z.coerce.number().int().min(1).optional(),
  DB_MAX_LIFETIME: z.coerce.number().int().min(60).optional(),
  /** Per-connection statement_timeout (ms). Caps runaway queries; 0 disables. Default: 30000. */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).optional(),
  /**
   * Per-request SET LOCAL statement_timeout (ms) for HTTP handlers (org RLS and non-org pinned tx).
   * Tighter than DB_STATEMENT_TIMEOUT_MS to release pool slots faster. Default: 5000. 0 disables SET LOCAL.
   */
  DB_HTTP_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
  /**
   * Rollout flag for scoped RLS contexts (item 2 of the production hardening plan). When true,
   * the per-HTTP-request `organization-rls-transaction` + `request-statement-timeout` pinning
   * is disabled and services are expected to wrap their unit-of-work calls in
   * `withOrganizationDatabaseContext(...)`. When false (default), the existing request-pinned
   * transaction model stays in place.
   *
   * Roll out per-route or per-environment. See `docs/reference/data/migrations.md` and the
   * RLS unpin chaos test for the migration sequencing.
   */
  DB_RLS_SCOPED_CONTEXTS: z.coerce.boolean().default(true),
  /** Per-connection idle_in_transaction_session_timeout (ms). Caps stuck transactions; 0 disables. Default: 30000. */
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).optional(),
  /** Warn when in-process org RLS checkouts reach this fraction of DB_MAX (default 0.8). */
  DB_POOL_ACTIVE_WARN_RATIO: z.coerce.number().min(0).max(1).default(0.8),
  /** Critical alert when in-process org RLS checkouts reach this fraction of DB_MAX (default 0.95). */
  DB_POOL_ACTIVE_CRITICAL_RATIO: z.coerce.number().min(0).max(1).default(0.95),
  /** Warn when cluster-wide active connections (pg_stat_activity) reach this fraction of allowed budget. */
  DB_POOL_CLUSTER_WARN_RATIO: z.coerce.number().min(0).max(1).default(0.8),
  /** Critical cluster pool pressure ratio (default 0.95). */
  DB_POOL_CLUSTER_CRITICAL_RATIO: z.coerce.number().min(0).max(1).default(0.95),
  /** Poll interval for pool exhaustion sampling and optional Prometheus gauges (ms). Default: 5000. */
  DB_POOL_ALERT_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  /** Consecutive over-threshold polls before emitting pool exhaustion alerts (default 2). */
  DB_POOL_ALERT_CONSECUTIVE_POLLS: z.coerce.number().int().min(1).max(10).default(2),
  /** When true, Postgres client verifies server TLS certificate (strict). Ignored when DATABASE_URL uses sslmode=verify-ca|verify-full (always strict). */
  DB_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),

  // Data retention (days to keep audit logs / revoked sessions before cleanup)
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1),
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
  SESSION_CLEANUP_CRON: z.string().min(1).optional(),
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

  /** Bounded SCAN cap for idempotency Redis key cardinality sampling (worker). */
  IDEMPOTENCY_CARDINALITY_SCAN_MAX: z.coerce.number().int().min(1).default(200_000),
  IDEMPOTENCY_CARDINALITY_WARN_THRESHOLD: z.coerce.number().int().min(1).default(50_000),
  IDEMPOTENCY_CARDINALITY_CRITICAL_THRESHOLD: z.coerce.number().int().min(1).default(200_000),
  IDEMPOTENCY_CARDINALITY_CRON: z.string().min(1).optional(),

  /** Alert when a dead-letter queue has at least this many waiting + failed jobs. */
  DLQ_DEPTH_WARN_THRESHOLD: z.coerce.number().int().min(1).default(10),
  DLQ_DEPTH_CRON: z.string().min(1).optional(),
  ENABLE_QUEUE_DASHBOARD: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /**
   * When false (default in production), Bull Board mutation APIs return 403; GET remains available.
   */
  ENABLE_QUEUE_DASHBOARD_MUTATIONS: z
    .string()
    .optional()
    .default(process.env.NODE_ENV === 'production' ? 'false' : 'true')
    .transform((v) => v === 'true' || v === '1'),

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

  // Response encryption (obfuscation layer — AES-256-CBC; hides JSON from DevTools Network tab)
  ENABLE_RESPONSE_ENCRYPTION: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  RESPONSE_ENCRYPTION_KEY: z.string().length(64).optional(), // 64 hex chars = 32 bytes for AES-256
  /** AES-256-GCM key for MFA/webhook secrets at rest (64 hex chars). Required in production. */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'SECRETS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .optional(),
});

export const envSchema = envSchemaBase
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        return Boolean(data.JWT_PRIVATE_KEY && data.JWT_PUBLIC_KEY);
      }
      return true;
    },
    {
      message:
        'In production, JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set (RS256 required for production)',
      path: ['JWT_PRIVATE_KEY'],
    },
  )
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
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production' && data.METRICS_ENABLED) {
        return Boolean(data.METRICS_BEARER_TOKEN && data.METRICS_BEARER_TOKEN.length >= 32);
      }
      return true;
    },
    {
      message:
        'When NODE_ENV=production and METRICS_ENABLED=true, METRICS_BEARER_TOKEN (min 32 chars) is required',
      path: ['METRICS_BEARER_TOKEN'],
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
      if (data.NODE_ENV === 'production') {
        return Boolean(data.SECRETS_ENCRYPTION_KEY);
      }
      return true;
    },
    {
      message: 'SECRETS_ENCRYPTION_KEY (64 hex chars) is required in production',
      path: ['SECRETS_ENCRYPTION_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') {
        return true;
      }
      return validateProductionRedisTopology(data.REDIS_URL, data.REDIS_BULLMQ_URL);
    },
    {
      message:
        'In production, REDIS_BULLMQ_URL must be unset or point to the same Redis endpoint as REDIS_URL (see docs/deployment/runbooks/redis-topology.md)',
      path: ['REDIS_BULLMQ_URL'],
    },
  )
  .refine(
    (data) => {
      /**
       * Magic-link token safety: when NODE_ENV is not production, FRONTEND_URL must be
       * a localhost address. Non-production runtimes inline the magic-link token in API
       * responses for local development, so a public FRONTEND_URL would leak tokens.
       */
      if (data.NODE_ENV === 'production' || !data.FRONTEND_URL) {
        return true;
      }
      try {
        const hostname = new URL(data.FRONTEND_URL).hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1';
      } catch {
        return false;
      }
    },
    {
      message:
        'FRONTEND_URL must be a localhost or 127.0.0.1 URL when NODE_ENV is not production (magic-link tokens are exposed in non-prod responses).',
      path: ['FRONTEND_URL'],
    },
  );

/** Ordered list of env var names from the schema (for .env.example sync and scripts). */
export const envSchemaKeys = Object.keys(envSchemaBase.shape) as (keyof z.infer<
  typeof envSchema
>)[];
