import {
  CircuitBreakerOpenError,
  type CircuitBreaker,
} from '@/infrastructure/resilience/circuit-breaker.js';
import {
  isTransientNetworkError,
  retryWithBackoff,
  type RetryWithBackoffOptions,
} from '@/infrastructure/resilience/retry-with-backoff.util.js';
import {
  classifyOutboundError,
  type ExternalServiceError,
  recordOutboundFailureBreadcrumb,
} from '@/infrastructure/outbound/outbound-error.js';
import {
  resolveOutboundDefaults,
  type OutboundIntegrationName,
} from '@/infrastructure/outbound/outbound-defaults.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

export type OutboundCallOptionsInput<T> = {
  name: OutboundIntegrationName;
  operation: (signal: AbortSignal) => Promise<T>;
  timeoutMs?: number | undefined;
  circuit?: CircuitBreaker | null | undefined;
  retry?: OutboundCallRetryOptions | undefined;
  requestId?: string | undefined;
  enforceAbortTimeout?: boolean | undefined;
  rethrowIf?: ((error: unknown) => boolean) | undefined;
};

export function buildOutboundCallOptions<T>(
  options: OutboundCallOptionsInput<T>,
): OutboundCallOptions<T> {
  return omitUndefined(options) as OutboundCallOptions<T>;
}

export interface OutboundCallRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export interface OutboundCallOptions<T> {
  name: OutboundIntegrationName;
  timeoutMs?: number;
  circuit?: CircuitBreaker | null;
  retry?: OutboundCallRetryOptions;
  requestId?: string;
  /** When false, the operation is not aborted by a façade timeout (e.g. Stripe SDK timeout). */
  enforceAbortTimeout?: boolean;
  /** When true, the error is logged and rethrown without wrapping in {@link ExternalServiceError}. */
  rethrowIf?: (error: unknown) => boolean;
  operation: (signal: AbortSignal) => Promise<T>;
}

function resolveAbortSignal(options: {
  timeoutMs: number;
  enforceAbortTimeout: boolean;
}): AbortSignal {
  if (!options.enforceAbortTimeout) {
    return new AbortController().signal;
  }
  return AbortSignal.timeout(options.timeoutMs);
}

async function runOperationWithOptionalRetry<T>(options: {
  operation: (signal: AbortSignal) => Promise<T>;
  signal: AbortSignal;
  retry?: OutboundCallRetryOptions;
}): Promise<T> {
  const { operation, signal, retry } = options;
  if (!retry) {
    return operation(signal);
  }

  const retryOptions = omitUndefined({
    maxAttempts: retry.maxAttempts,
    baseDelayMs: retry.baseDelayMs,
    maxDelayMs: retry.maxDelayMs,
    jitterRatio: retry.jitterRatio,
    shouldRetry:
      retry.shouldRetry ??
      ((error: unknown) =>
        !(error instanceof CircuitBreakerOpenError) && isTransientNetworkError(error)),
  }) as RetryWithBackoffOptions;

  return retryWithBackoff(() => operation(signal), retryOptions);
}

function logOutboundFailure(options: {
  integration: OutboundIntegrationName;
  error: ExternalServiceError;
  requestId?: string;
  attempt?: number;
  durationMs: number;
  transient: boolean;
}): void {
  const payload = {
    integration: options.integration,
    category: options.error.category,
    requestId: options.requestId,
    attempt: options.attempt,
    durationMs: options.durationMs,
    status: options.error.status,
    retryAfterMs: options.error.retryAfterMs,
  };

  if (options.transient) {
    logger.warn(payload, 'outbound.call.failed.transient');
  } else {
    logger.error(payload, 'outbound.call.failed');
  }
}

/**
 * Executes an outbound operation with optional circuit breaker, timeout, retry, and
 * uniform error classification. Retry runs inside a single circuit `execute()` when both are set.
 */
export async function outboundCall<T>(options: OutboundCallOptions<T>): Promise<T> {
  const resolved = buildOutboundCallOptions(options);

  const defaults = resolveOutboundDefaults(resolved.name);
  const timeoutMs = resolved.timeoutMs ?? defaults.timeoutMs;
  const circuit = resolved.circuit === null ? undefined : (resolved.circuit ?? defaults.circuit);
  const enforceAbortTimeout = resolved.enforceAbortTimeout ?? true;
  const signal = resolveAbortSignal({ timeoutMs, enforceAbortTimeout });
  const startedAt = Date.now();

  const executeOnce = async (): Promise<T> => {
    const run = async (): Promise<T> =>
      runOperationWithOptionalRetry(
        omitUndefined({
          operation: resolved.operation,
          signal,
          retry: resolved.retry,
        }),
      );

    if (circuit) {
      return circuit.execute(run);
    }
    return run();
  };

  try {
    return await executeOnce();
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError || resolved.rethrowIf?.(error)) {
      const externalError = classifyOutboundError(error, resolved.name);
      const durationMs = Date.now() - startedAt;
      logOutboundFailure(
        omitUndefined({
          integration: resolved.name,
          error: externalError,
          requestId: resolved.requestId,
          durationMs,
          transient: error instanceof CircuitBreakerOpenError,
        }),
      );
      recordOutboundFailureBreadcrumb(
        omitUndefined({
          integration: resolved.name,
          category: externalError.category,
          requestId: resolved.requestId,
          durationMs,
          status: externalError.status,
        }),
      );
      throw error;
    }

    const externalError = classifyOutboundError(error, resolved.name);
    const durationMs = Date.now() - startedAt;
    const transient = isTransientNetworkError(error) || error instanceof CircuitBreakerOpenError;

    logOutboundFailure(
      omitUndefined({
        integration: resolved.name,
        error: externalError,
        requestId: resolved.requestId,
        durationMs,
        transient,
      }),
    );

    recordOutboundFailureBreadcrumb(
      omitUndefined({
        integration: resolved.name,
        category: externalError.category,
        requestId: resolved.requestId,
        durationMs,
        status: externalError.status,
      }),
    );

    throw externalError;
  }
}
