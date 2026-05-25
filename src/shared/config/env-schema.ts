/**
 * Env Zod schema and key list only. Safe to import from scripts that must not run getEnv()
 * (e.g. sync-env-example). Application code should use env.config.ts for getEnv() and env.
 */
import { validateProductionRedisTopology } from '@/infrastructure/cache/redis-url.parse.util.js';
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

const envSchemaBase = z.object({
  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Fastify HTTP bind address (worker health server also binds here). */
  HTTP_BIND_HOST: z.string().min(1).default('0.0.0.0'),
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
  /** RS256 PEM private key. Required in every runtime; NODE_ENV is metadata only. */
  JWT_PRIVATE_KEY: z.string().min(1),
  /** RS256 PEM public key. Required in every runtime; NODE_ENV is metadata only. */
  JWT_PUBLIC_KEY: z.string().min(1),
  /** Key id in JWT header when signing with RS256 (default: `default`). */
  JWT_SIGNING_KID: z.string().min(1).optional().default('default'),
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
   * NODE_ENV is metadata only; disable explicitly with METRICS_ENABLED=false.
   */
  METRICS_ENABLED: booleanString('true'),
  /** Bearer token a Prometheus scraper sends when scraping /metrics. Required when METRICS_ENABLED=true (min 32 chars). */
  METRICS_SCRAPE_TOKEN: z.string().min(32).optional(),
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
  /**
   * Use presigned POST (with an S3-enforced content-length-range) instead of presigned PUT
   * for direct client uploads. Off by default; the response then carries `uploadMethod` and,
   * for POST, the policy `fields` clients must submit with the file.
   */
  UPLOAD_USE_PRESIGNED_POST: booleanString('false'),
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
  /**
   * Headroom (pooled connections) the worker process keeps free for the ~18 always-registered
   * single-concurrency background workers (retention/tombstone/monitoring crons) on top of
   * WORKER_CONCURRENCY. Heuristic buffer, not a per-worker reservation. Default 6.
   */
  WORKER_BACKGROUND_POOL_SLOT_RESERVE: z.coerce.number().int().min(0).max(64).default(6),
  /** Postgres pool size per Node process (postgres-js `max`). Not the cluster-wide total. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).optional(),
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
   * Per-request SET LOCAL statement_timeout (ms) for HTTP handlers (org RLS and non-org pinned tx).
   * Tighter than DATABASE_STATEMENT_TIMEOUT_MS to release pool slots faster. Default: 5000. 0 disables SET LOCAL.
   */
  DATABASE_HTTP_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
  /**
   * Rollout flag for scoped RLS contexts (item 2 of the production hardening plan). When true,
   * the per-HTTP-request `organization-rls-transaction` + `request-statement-timeout` pinning
   * is disabled and services are expected to wrap their unit-of-work calls in
   * `withOrganizationDatabaseContext(...)` or `withUserDatabaseContext(...)`. When false,
   * the legacy request-pinned transaction model stays in place.
   *
   * Prerequisites for safely enabling `true` in an environment:
   *   1. Apply migration `20260520000004_organization_discovery_and_invitation_lookup_rls.sql`
   *      (adds `organizations_user_discovery` + `memberships_user_self_discovery` policies and
   *      the `tenancy.resolve_member_invitation_lookup_by_public_id` /
   *      `tenancy.list_pending_member_invitations_for_email` SECURITY DEFINER helpers).
   *   2. Confirm services on the deployment wrap cross-org reads in
   *      `withUserDatabaseContext` (organization list/getByPublicId/getBySlug/create) and that
   *      invitation accept/decline/listPending resolve the owning org via the SECURITY DEFINER
   *      lookup before writing.
   *
   * Roll out per-environment by flipping the env var; the schema default remains `true` so new
   * environments inherit the post-migration mode. See
   * `docs/deployment/runbooks/resource-limits.md` for the full rollout sequence.
   */
  DATABASE_RLS_SCOPED_CONTEXTS: z.coerce.boolean().default(true),
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
  /** When true, Postgres client verifies server TLS certificate (strict). Ignored when DATABASE_URL uses sslmode=verify-ca|verify-full (always strict). */
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().optional(),
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
  /**
   * Production safety acknowledgement. CAPTCHA fail-closes on public auth routes, so a
   * production deploy with CAPTCHA_PROVIDER=disabled (the default) would turn login and
   * recovery into 401s. Boot fails in that case unless this is explicitly set to true,
   * which also switches the middleware to fail-open (skip CAPTCHA) instead of 401.
   */
  CAPTCHA_DISABLED_ACK: booleanString('false'),

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
  /** AES-256-GCM key for MFA/webhook secrets at rest (64 hex chars). Required in every runtime. */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'SECRETS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
});

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
      if (data.NODE_ENV !== 'production') {
        return true;
      }
      if (data.CAPTCHA_PROVIDER === 'turnstile') {
        return true;
      }
      return data.CAPTCHA_DISABLED_ACK === true;
    },
    {
      message:
        'In production, configure CAPTCHA (CAPTCHA_PROVIDER=turnstile + CAPTCHA_SECRET) or set CAPTCHA_DISABLED_ACK=true to explicitly run with CAPTCHA disabled (fail-open on auth routes)',
      path: ['CAPTCHA_PROVIDER'],
    },
  )
  .refine(
    (data) => {
      return validateProductionRedisTopology(data.REDIS_URL, data.REDIS_BULLMQ_URL);
    },
    {
      message:
        'REDIS_BULLMQ_URL must be unset or point to the same Redis endpoint as REDIS_URL (see docs/deployment/runbooks/redis-topology.md)',
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
  .filter(([, schema]) => !(schema as z.ZodTypeAny).isOptional())
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
    condition: 'CAPTCHA_PROVIDER=turnstile (schema default is `disabled`)',
  },
  {
    key: 'CAPTCHA_DISABLED_ACK',
    condition:
      'NODE_ENV=production with CAPTCHA_PROVIDER=disabled (must be true to acknowledge fail-open auth routes)',
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
