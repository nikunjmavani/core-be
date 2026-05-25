/** Production defaults aligned with production-readiness checklist #66 / #91. */
export const PRODUCTION_TRACES_SAMPLE_RATE = 0.05;
export const PRODUCTION_PROFILE_SESSION_SAMPLE_RATE = 0.1;

export type TracesSamplingContext = {
  name?: string;
  attributes?: Record<string, unknown>;
  parentSampled?: boolean;
  inheritOrSampleWith?: (fallbackRate: number) => number;
};

export type TransactionTailInput = {
  event_id?: string;
  transaction?: string;
  start_timestamp?: number;
  timestamp?: number;
  tags?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
};

export type TailTransactionDecision = 'drop' | 'keep';

const HEALTH_TRANSACTION_MARKERS = ['/health', 'GET /health'] as const;

export function isHealthCheckTransaction(transactionName: string): boolean {
  if (HEALTH_TRANSACTION_MARKERS.some((marker) => transactionName === marker)) {
    return true;
  }
  return transactionName.includes('/health/');
}

export function isBillingOrWebhookTransaction(transactionName: string): boolean {
  return /\/api\/v1\/billing\b/i.test(transactionName) || /stripe\/webhook/i.test(transactionName);
}

export function isErrorLikeTransactionName(transactionName: string): boolean {
  return /error/i.test(transactionName);
}

function readNumericAttribute(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Reads the HTTP status from a finished transaction (tail sampling).
 */
export function extractHttpResponseStatusCode(input: TransactionTailInput): number | undefined {
  const tagStatus =
    readNumericAttribute(input.tags?.['http.response.status_code']) ??
    readNumericAttribute(input.tags?.['http.status_code']) ??
    readNumericAttribute(input.tags?.status_code);
  if (tagStatus !== undefined) {
    return tagStatus;
  }

  const responseContext = input.contexts?.response;
  if (responseContext) {
    const contextStatus =
      readNumericAttribute(responseContext.status_code) ??
      readNumericAttribute(responseContext.statusCode);
    if (contextStatus !== undefined) {
      return contextStatus;
    }
  }

  return undefined;
}

export function getTransactionDurationMs(input: TransactionTailInput): number | undefined {
  const start = input.start_timestamp;
  const end = input.timestamp;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return undefined;
  }
  return (end - start) * 1000;
}

/**
 * Head sampling: baseline `defaultTracesSampleRate`, always sample errors,
 * 5xx, slow requests, and billing/webhook routes. Health checks are not sampled.
 */
export function resolveTracesSampleRate(
  samplingContext: TracesSamplingContext,
  defaultTracesSampleRate: number,
  slowTransactionThresholdMs: number,
): number {
  const transactionName = samplingContext.name ?? '';

  if (isHealthCheckTransaction(transactionName)) {
    return 0;
  }

  if (shouldAlwaysSampleTraceAtHead(samplingContext, slowTransactionThresholdMs)) {
    return 1.0;
  }

  if (samplingContext.inheritOrSampleWith) {
    return samplingContext.inheritOrSampleWith(defaultTracesSampleRate);
  }

  return defaultTracesSampleRate;
}

function shouldAlwaysSampleTraceAtHead(
  samplingContext: TracesSamplingContext,
  slowTransactionThresholdMs: number,
): boolean {
  const statusCode = readNumericAttribute(
    samplingContext.attributes?.['http.response.status_code'],
  );
  if (statusCode !== undefined && statusCode >= 400) {
    return true;
  }

  const transactionName = samplingContext.name ?? '';
  if (
    isErrorLikeTransactionName(transactionName) ||
    isBillingOrWebhookTransaction(transactionName)
  ) {
    return true;
  }

  const durationMs = readNumericAttribute(
    samplingContext.attributes?.['http.server.request.duration_ms'] ??
      samplingContext.attributes?.['http.response.duration_ms'],
  );
  return durationMs !== undefined && durationMs >= slowTransactionThresholdMs;
}

/**
 * Tail sampling after the transaction completes: always keep errors, slow paths,
 * and billing/webhook traffic; apply the baseline rate to successful fast requests.
 */
export function shouldAlwaysKeepTransactionAtTail(
  input: TransactionTailInput,
  slowTransactionThresholdMs: number,
): boolean {
  const transactionName = input.transaction ?? '';
  const statusCode = extractHttpResponseStatusCode(input);
  if (statusCode !== undefined && statusCode >= 400) {
    return true;
  }

  if (
    isErrorLikeTransactionName(transactionName) ||
    isBillingOrWebhookTransaction(transactionName)
  ) {
    return true;
  }

  const durationMs = getTransactionDurationMs(input);
  return durationMs !== undefined && durationMs >= slowTransactionThresholdMs;
}

function deterministicTailKeep(eventKey: string, baselineTracesSampleRate: number): boolean {
  const normalizedRate = Math.min(1, Math.max(0, baselineTracesSampleRate));
  if (normalizedRate >= 1) {
    return true;
  }
  if (normalizedRate <= 0) {
    return false;
  }

  let hash = 0;
  for (let index = 0; index < eventKey.length; index += 1) {
    hash = (hash * 31 + eventKey.charCodeAt(index)) >>> 0;
  }

  return (hash % 10_000) / 10_000 < normalizedRate;
}

export function resolveTailTransactionDecision(
  input: TransactionTailInput,
  baselineTracesSampleRate: number,
  slowTransactionThresholdMs: number,
): TailTransactionDecision {
  const transactionName = input.transaction ?? '';
  if (isHealthCheckTransaction(transactionName)) {
    return 'drop';
  }

  if (shouldAlwaysKeepTransactionAtTail(input, slowTransactionThresholdMs)) {
    return 'keep';
  }

  const eventKey =
    input.event_id ??
    `${transactionName}:${String(input.start_timestamp ?? '')}:${String(input.timestamp ?? '')}`;
  return deterministicTailKeep(eventKey, baselineTracesSampleRate) ? 'keep' : 'drop';
}

/**
 * Tags slow transactions for Sentry Performance filters (does not affect keep/drop).
 */
export function annotateSlowTransactionIfNeeded(
  input: TransactionTailInput,
  slowTransactionThresholdMs: number,
): Record<string, string | number | boolean> | undefined {
  const durationMs = getTransactionDurationMs(input);
  if (durationMs === undefined || durationMs < slowTransactionThresholdMs) {
    return undefined;
  }
  const tags: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input.tags ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // eslint-disable-next-line security/detect-object-injection -- key from Object.entries iteration over typed tags.
      tags[key] = value;
    }
  }
  return { ...tags, slow_transaction: 'true' };
}
