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

/**
 * Scrubs secrets from a Sentry error event before it is sent upstream.
 * Shared by `beforeSend` and unit tests.
 */
export function redactSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.data) {
        breadcrumb.data = redactSensitive(breadcrumb.data);
      }
    }
  }
  if (event.request) {
    if (event.request.headers) {
      event.request.headers = redactSensitive(event.request.headers);
    }
    if (event.request.cookies) {
      event.request.cookies = redactSensitive(event.request.cookies);
    }
    if (event.request.data !== undefined) {
      event.request.data = redactSensitive(event.request.data);
    }
    if (event.request.query_string !== undefined) {
      event.request.query_string = redactSensitive(event.request.query_string);
    }
    if (event.request.url !== undefined) {
      event.request.url = redactSensitive(event.request.url);
    }
  }
  if (event.extra) {
    event.extra = redactSensitive(event.extra);
  }
  if (event.contexts) {
    event.contexts = redactSensitive(event.contexts);
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

  const isProduction = env.NODE_ENV === 'production';
  const defaultTracesSampleRate =
    env.SENTRY_TRACES_SAMPLE_RATE ?? (isProduction ? PRODUCTION_TRACES_SAMPLE_RATE : 1.0);
  const profileSessionSampleRate =
    env.SENTRY_PROFILE_SAMPLE_RATE ?? (isProduction ? PRODUCTION_PROFILE_SESSION_SAMPLE_RATE : 1.0);
  const slowTransactionThresholdMs = env.SENTRY_SLOW_TRANSACTION_MS;
  const release =
    env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    ...(release ? { release } : {}),

    // Avoid shipping emails, cookies, and raw IPs by default — breadcrumbs are redacted in beforeSend.
    sendDefaultPii: false,

    // ── Integrations ────────────────────────────────────────────────
    integrations: [
      // V8-based continuous profiling (native addon)
      nodeProfilingIntegration(),

      // Auto-instrument outbound HTTP calls
      Sentry.httpIntegration(),

      // Auto-instrument Postgres queries (via postgres.js / pg)
      Sentry.postgresIntegration(),

      // Auto-instrument Redis commands (via ioredis)
      Sentry.redisIntegration(),
    ],

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
    debug: env.NODE_ENV === 'local',
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
  error: Error | unknown,
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
