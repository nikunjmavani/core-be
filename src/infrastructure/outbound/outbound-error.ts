import * as Sentry from '@sentry/node';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { isTransientNetworkError } from '@/infrastructure/resilience/retry-with-backoff.util.js';
import { AppError } from '@/shared/errors/app.error.js';
import type { OutboundIntegrationName } from '@/infrastructure/outbound/outbound-defaults.js';

/**
 * Coarse classification of why an outbound call failed. Drives retry decisions
 * ({@link isOutboundRetryable}), log severity in {@link outboundCall}, and Sentry
 * breadcrumb labelling.
 */
export type OutboundCategory =
  | 'timeout'
  | 'network'
  | 'circuit_open'
  | 'http_4xx'
  | 'http_5xx'
  | 'aborted'
  | 'unknown';

/**
 * Typed wrapper for any failure that escaped an outbound integration. Always surfaces as
 * a 503 `SERVICE_UNAVAILABLE` to clients with the integration name baked into the i18n
 * payload; the original error is preserved on `cause` for debugging and breadcrumbs.
 */
export class ExternalServiceError extends AppError {
  readonly integration: OutboundIntegrationName;
  readonly category: OutboundCategory;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly upstreamRequestId?: string;
  override readonly cause?: unknown;

  constructor(options: {
    integration: OutboundIntegrationName;
    category: OutboundCategory;
    status?: number;
    retryAfterMs?: number;
    upstreamRequestId?: string;
    cause?: unknown;
    messageKey?: string;
    fallbackMessage?: string;
  }) {
    super(
      'SERVICE_UNAVAILABLE',
      503,
      options.messageKey ?? 'errors:externalServiceUnavailable',
      { integration: options.integration },
      options.fallbackMessage ??
        `Outbound call to ${options.integration} failed (${options.category})`,
    );
    this.integration = options.integration;
    this.category = options.category;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    if (options.upstreamRequestId !== undefined) {
      this.upstreamRequestId = options.upstreamRequestId;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * True when an outbound failure is safe to retry: circuit-open, transient network
 * errors, timeouts/aborts, and 5xx upstream responses. 4xx responses are treated as
 * caller errors and not retried automatically.
 */
export function isOutboundRetryable(error: unknown): boolean {
  if (error instanceof CircuitBreakerOpenError) {
    return true;
  }
  if (error instanceof ExternalServiceError) {
    return (
      error.category === 'timeout' ||
      error.category === 'network' ||
      error.category === 'circuit_open' ||
      error.category === 'http_5xx' ||
      error.category === 'aborted'
    );
  }
  return isTransientNetworkError(error);
}

/**
 * Normalizes any thrown value into an {@link ExternalServiceError} with an inferred
 * {@link OutboundCategory}. Recognizes already-classified errors, circuit-open errors,
 * `AbortError`/`TimeoutError`, `HTTP NNN` substrings in error messages, and transient
 * network signatures; everything else lands in `unknown`.
 */
export function classifyOutboundError(
  error: unknown,
  integration: OutboundIntegrationName,
): ExternalServiceError {
  if (error instanceof ExternalServiceError) {
    return error;
  }

  if (error instanceof CircuitBreakerOpenError) {
    return new ExternalServiceError({
      integration,
      category: 'circuit_open',
      retryAfterMs: error.retryAfterMs,
      cause: error,
      fallbackMessage: error.message,
    });
  }

  if (error instanceof AppError) {
    return new ExternalServiceError({
      integration,
      category: 'unknown',
      cause: error,
      fallbackMessage: error.message,
    });
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      const category: OutboundCategory =
        error.message.includes('aborted') && !error.message.includes('timeout')
          ? 'aborted'
          : 'timeout';
      return new ExternalServiceError({
        integration,
        category,
        cause: error,
        fallbackMessage: error.message,
      });
    }

    const statusMatch = /HTTP\s+(\d{3})/i.exec(error.message);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      let category: OutboundCategory;
      if (status >= 500) {
        category = 'http_5xx';
      } else if (status >= 400) {
        category = 'http_4xx';
      } else {
        category = 'unknown';
      }
      return new ExternalServiceError({
        integration,
        category,
        status,
        cause: error,
        fallbackMessage: error.message,
      });
    }

    if (isTransientNetworkError(error)) {
      return new ExternalServiceError({
        integration,
        category: 'network',
        cause: error,
        fallbackMessage: error.message,
      });
    }
  }

  return new ExternalServiceError({
    integration,
    category: 'unknown',
    cause: error,
    fallbackMessage: error instanceof Error ? error.message : 'Unknown outbound error',
  });
}

/**
 * Adds a warning-level Sentry breadcrumb tagged `outbound.<integration>.<category>` so
 * subsequent error reports include the upstream failure context (integration, request id,
 * attempt, duration, status) without needing a separate event.
 */
export function recordOutboundFailureBreadcrumb(options: {
  integration: OutboundIntegrationName;
  category: OutboundCategory;
  requestId?: string;
  attempt?: number;
  durationMs?: number;
  status?: number;
}): void {
  Sentry.addBreadcrumb({
    category: 'outbound',
    level: 'warning',
    message: `outbound.${options.integration}.${options.category}`,
    data: {
      integration: options.integration,
      category: options.category,
      request_id: options.requestId,
      attempt: options.attempt,
      duration_ms: options.durationMs,
      status: options.status,
    },
  });
}
