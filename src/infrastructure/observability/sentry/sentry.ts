import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { redactSensitive } from '@/shared/utils/security/sensitive-redaction.util.js';
import {
  PRODUCTION_PROFILE_SESSION_SAMPLE_RATE,
  PRODUCTION_TRACES_SAMPLE_RATE,
  annotateSlowTransactionIfNeeded,
  resolveTailTransactionDecision,
  resolveTracesSampleRate,
} from '@/infrastructure/observability/sentry/sentry-sampling.util.js';

let initialized = false;

/** Redacts secrets from each breadcrumb's `data` payload in place. */
function redactSentryBreadcrumbsInPlace(
  breadcrumbs: NonNullable<Sentry.ErrorEvent['breadcrumbs']>,
): void {
  for (const breadcrumb of breadcrumbs) {
    if (breadcrumb.data) {
      breadcrumb.data = redactSensitive(breadcrumb.data);
    }
  }
}

function redactSentryRequestInPlace(request: NonNullable<Sentry.ErrorEvent['request']>): void {
  if (request.headers) {
    request.headers = redactSensitive(request.headers);
  }
  if (request.cookies) {
    request.cookies = redactSensitive(request.cookies);
  }
  if (request.data !== undefined) {
    request.data = redactSensitive(request.data);
  }
  if (request.query_string !== undefined) {
    request.query_string = redactSensitive(request.query_string);
  }
  if (request.url !== undefined) {
    request.url = redactSensitive(request.url);
  }
}

/**
 * Scrubs secrets from a Sentry error event before it is sent upstream.
 * Shared by `beforeSend` and unit tests.
 */
export function redactSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.breadcrumbs) {
    redactSentryBreadcrumbsInPlace(event.breadcrumbs);
  }
  if (event.request) {
    redactSentryRequestInPlace(event.request);
  }
  if (event.extra) {
    event.extra = redactSensitive(event.extra);
  }
  if (event.contexts) {
    event.contexts = redactSensitive(event.contexts);
  }
  // sec-C6: pino redacts by KEY, so secrets interpolated into Error
  // messages or thrown values bypass the standard redaction pipeline and
  // ship verbatim to Sentry. Walk every textual surface here.
  if (typeof event.message === 'string') {
    event.message = redactSensitive(event.message);
  }
  if (event.user) {
    event.user = redactSensitive(event.user);
  }
  if (event.tags) {
    event.tags = redactSensitive(event.tags);
  }
  if (event.exception?.values) {
    for (const value of event.exception.values) {
      if (typeof value.value === 'string') {
        value.value = redactSensitive(value.value);
      }
    }
  }
  return event;
}

/**
 * Initialize Sentry with error tracking, performance tracing, continuous
 * profiling (V8 CpuProfiler), structured logs, and auto-instrumentation
 * for HTTP / Postgres / Redis.
 *
 * Call this **before** building the Fastify app or starting workers.
 * No-op when SENTRY_DSN is not configured.
 */
export function initSentry(): void {
  if (initialized) return;

  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    logger.info('SENTRY_DSN not configured — Sentry disabled');
    return;
  }

  const reducedSampling = env.SENTRY_REDUCED_SAMPLING;
  const defaultTracesSampleRate =
    env.SENTRY_TRACES_SAMPLE_RATE ?? (reducedSampling ? PRODUCTION_TRACES_SAMPLE_RATE : 1.0);
  const profileSessionSampleRate =
    env.SENTRY_PROFILE_SAMPLE_RATE ??
    (reducedSampling ? PRODUCTION_PROFILE_SESSION_SAMPLE_RATE : 1.0);
  const slowTransactionThresholdMs = env.SENTRY_SLOW_TRANSACTION_MS;
  const release =
    env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;

  // Tracing/profiling instrumentation wraps every HTTP/DB/cache call and adds per-call CPU even
  // when the trace is ultimately sampled out (the wrapper runs before the sampling decision). Only
  // install the pure-tracing integrations when tracing is actually enabled, and the profiler only
  // when profiling is enabled. `httpIntegration` is always installed: besides outbound-HTTP tracing
  // it provides the per-request isolation scope that gives captured errors their route/request
  // context, so dropping it would degrade error reports even though error capture itself is cheap.
  const tracingEnabled = defaultTracesSampleRate > 0;
  const profilingEnabled = profileSessionSampleRate > 0;
  // Build via conditional spreads so the array's element type is the union of the
  // integration return types (each extends Integration) — `.push` of a differently
  // named integration would otherwise be rejected under exactOptionalPropertyTypes.
  const integrations = [
    Sentry.httpIntegration(),
    ...(profilingEnabled ? [nodeProfilingIntegration()] : []),
    ...(tracingEnabled ? [Sentry.postgresIntegration(), Sentry.redisIntegration()] : []),
  ];

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    ...(release ? { release } : {}),

    // Avoid shipping emails, cookies, and raw IPs by default — breadcrumbs are redacted in beforeSend.
    sendDefaultPii: false,

    // ── Integrations ────────────────────────────────────────────────
    // Built above: error capture always on; tracing (pg/redis) + profiling only when enabled.
    integrations,

    // ── Tracing ─────────────────────────────────────────────────────
    // Env var override → code default (0.05 prod) → tracesSampler boosts errors/5xx
    tracesSampleRate: defaultTracesSampleRate,
    tracesSampler: (samplingContext) =>
      resolveTracesSampleRate(samplingContext, defaultTracesSampleRate, slowTransactionThresholdMs),

    // ── Profiling ───────────────────────────────────────────────────
    // Session-level sampling: decides once at SDK init whether this
    // process instance is profiled. Replaces the deprecated profilesSampleRate.
    profileSessionSampleRate,

    // Profiler auto-starts/stops tied to active spans — no manual calls.
    profileLifecycle: 'trace',

    // ── Structured Sentry Logs ──────────────────────────────────────
    _experiments: {
      enableLogs: true,
    },

    // ── Privacy / noise filters ─────────────────────────────────────
    beforeSend(event) {
      return redactSentryEvent(event);
    },

    beforeSendTransaction(event) {
      const tailDecision = resolveTailTransactionDecision(
        event,
        defaultTracesSampleRate,
        slowTransactionThresholdMs,
      );
      if (tailDecision === 'drop') {
        return null;
      }
      const slowTransactionTags = annotateSlowTransactionIfNeeded(
        event,
        slowTransactionThresholdMs,
      );
      if (slowTransactionTags !== undefined) {
        event.tags = slowTransactionTags;
      }
      return event;
    },

    // ── Debug (local only) ──────────────────────────────────────────
    debug: env.SENTRY_DEBUG,
  });

  initialized = true;
  logger.info(
    {
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: release ?? 'unset',
      tracesSampleRate: defaultTracesSampleRate,
      profileSessionSampleRate,
      profileLifecycle: 'trace',
    },
    'Sentry initialized with profiling',
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Capture an exception in Sentry with optional context.
 */
export function captureException(
  error: unknown,
  context?: {
    userId?: string;
    organizationId?: string;
    requestId?: string;
    tags?: Record<string, string>;
  },
): void {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context?.organizationId) scope.setTag('organization_id', context.organizationId);
    if (context?.requestId) scope.setTag('request_id', context.requestId);
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    Sentry.captureException(error);
  });
}

/**
 * Capture a Sentry message (for cardinality / ops signals where no Error exists).
 */
export function captureMessage(
  message: string,
  options?: {
    level?: 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';
    extra?: Record<string, unknown>;
  },
): void {
  if (!initialized) return;

  const captureContext = omitUndefined({
    level: options?.level ?? 'info',
    extra: options?.extra,
  });
  Sentry.captureMessage(message, captureContext);
}

/**
 * Add a structured Sentry breadcrumb without sending a `captureMessage` event.
 *
 * @remarks
 * Cheap (no rate limit, no quota consumption) and ideal for per-request signal trails
 * (sec-C/M finding #16 — captcha misconfiguration). Breadcrumbs are attached to the next
 * captured event automatically, so an operator opening a triggered alert sees the
 * forensic trail without each call generating its own ingestion line.
 */
export function addSentryBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';
  data?: Record<string, unknown>;
}): void {
  if (!initialized) return;
  Sentry.addBreadcrumb({
    category: breadcrumb.category,
    message: breadcrumb.message,
    level: breadcrumb.level ?? 'info',
    ...(breadcrumb.data !== undefined ? { data: breadcrumb.data } : {}),
  });
}

/**
 * Flush pending Sentry events (call before process.exit).
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}

/**
 * Check whether Sentry has been initialized.
 */
export function isSentryInitialized(): boolean {
  return initialized;
}

export { Sentry };
