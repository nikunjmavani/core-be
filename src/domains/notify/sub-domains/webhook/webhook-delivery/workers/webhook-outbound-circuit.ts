import { randomInt } from 'node:crypto';
import CircuitBreaker from 'opossum';
import type { WebhookDeliveryFetch } from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.js';
import { safeWebhookUrlForLogs } from '@/shared/utils/security/safe-webhook-url-for-logs.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  FIVE_SECONDS_MS,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  TEN_SECONDS_MS,
} from '@/shared/constants/ttl.constants.js';

const WEBHOOK_FETCH_TIMEOUT_MS = 30_000;

/** Maximum number of per-webhook circuit breakers kept resident (LRU eviction beyond this). */
const WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES = 5_000;
/** Idle time after which an unused breaker is evicted and shut down (1 hour). */
const WEBHOOK_CIRCUIT_CACHE_IDLE_TTL_MS = MILLISECONDS_PER_HOUR;

/** Extra request budget beyond the fetch timeout before Opossum trips the breaker (ms). */
const WEBHOOK_CIRCUIT_TIMEOUT_BUFFER_MS = FIVE_SECONDS_MS;
/** Opossum error-rate threshold (percent) over the rolling volume before the breaker opens. */
const WEBHOOK_CIRCUIT_ERROR_THRESHOLD_PERCENTAGE = 50;
/** Time the breaker stays open before allowing a half-open trial request (ms). */
const WEBHOOK_CIRCUIT_RESET_TIMEOUT_MS = MILLISECONDS_PER_MINUTE;
/** Minimum calls in the rolling window before the error percentage is evaluated. */
const WEBHOOK_CIRCUIT_VOLUME_THRESHOLD = 5;
/** Maximum jitter added to delivery backoff, as a fraction of the base delay. */
const WEBHOOK_DELIVERY_BACKOFF_JITTER_RATIO = 0.3;

/** Cache entry pairing a breaker with the last time it was accessed (for idle-TTL eviction). */
type WebhookCircuitCacheEntry = {
  circuit: CircuitBreaker;
  lastAccessedAtMs: number;
};

/**
 * Bounded LRU+TTL cache of circuit breakers keyed by internal webhook id (not URL). Insertion
 * order tracks access recency because every read re-inserts the touched entry, so the front of
 * the map is always the least-recently-used. Keying by id means a URL change reuses the same
 * breaker instead of orphaning the old one, and the cap + idle TTL bound worker memory.
 */
const circuitsByWebhookId = new Map<string, WebhookCircuitCacheEntry>();

async function executeWebhookFetch(
  webhookUrl: string,
  init: RequestInit,
  fetchImplementation: WebhookDeliveryFetch,
): Promise<Response> {
  return fetchImplementation(webhookUrl, init);
}

function attachCircuitEventListeners(
  circuit: CircuitBreaker,
  logContext: { webhookId: string; webhookUrl: string },
): void {
  const safeUrl = safeWebhookUrlForLogs(logContext.webhookUrl);
  const redactedContext = { webhookId: logContext.webhookId, ...safeUrl };

  circuit.on('open', () => {
    logger.warn(redactedContext, 'webhook.outbound.circuit.open');
  });

  circuit.on('halfOpen', () => {
    logger.info(redactedContext, 'webhook.outbound.circuit.half_open');
  });

  circuit.on('close', () => {
    logger.info(redactedContext, 'webhook.outbound.circuit.closed');
  });
}

/** Touch an entry so it becomes most-recently-used (move-to-end + refresh timestamp). */
function touchCircuitCacheEntry(
  webhookId: string,
  entry: WebhookCircuitCacheEntry,
  nowMs: number,
): void {
  entry.lastAccessedAtMs = nowMs;
  circuitsByWebhookId.delete(webhookId);
  circuitsByWebhookId.set(webhookId, entry);
}

/** Evict idle entries from the front of the map (least-recently-used first). */
function evictExpiredCircuits(nowMs: number): void {
  for (const [webhookId, entry] of circuitsByWebhookId) {
    if (nowMs - entry.lastAccessedAtMs <= WEBHOOK_CIRCUIT_CACHE_IDLE_TTL_MS) break;
    entry.circuit.shutdown();
    circuitsByWebhookId.delete(webhookId);
  }
}

/** Evict the least-recently-used entries until there is room for a new breaker. */
function evictLeastRecentlyUsedIfFull(): void {
  while (circuitsByWebhookId.size >= WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES) {
    const oldestKey = circuitsByWebhookId.keys().next().value;
    if (oldestKey === undefined) break;
    circuitsByWebhookId.get(oldestKey)?.circuit.shutdown();
    circuitsByWebhookId.delete(oldestKey);
  }
}

function getWebhookOutboundCircuit(webhookId: string, webhookUrl: string): CircuitBreaker {
  const nowMs = Date.now();
  evictExpiredCircuits(nowMs);

  const existing = circuitsByWebhookId.get(webhookId);
  if (existing) {
    touchCircuitCacheEntry(webhookId, existing, nowMs);
    return existing.circuit;
  }

  evictLeastRecentlyUsedIfFull();

  const circuit = new CircuitBreaker(executeWebhookFetch, {
    timeout: WEBHOOK_FETCH_TIMEOUT_MS + WEBHOOK_CIRCUIT_TIMEOUT_BUFFER_MS,
    errorThresholdPercentage: WEBHOOK_CIRCUIT_ERROR_THRESHOLD_PERCENTAGE,
    resetTimeout: WEBHOOK_CIRCUIT_RESET_TIMEOUT_MS,
    volumeThreshold: WEBHOOK_CIRCUIT_VOLUME_THRESHOLD,
    name: `webhook-outbound:${webhookId}`,
  });

  attachCircuitEventListeners(circuit, { webhookId, webhookUrl });
  circuitsByWebhookId.set(webhookId, { circuit, lastAccessedAtMs: nowMs });
  return circuit;
}

/** Options for {@link fetchWebhookWithCircuitBreaker}. */
export interface FetchWebhookWithCircuitBreakerOptions {
  /** Internal webhook id — the breaker cache key (stable across URL updates). */
  webhookId: number | string;
  /** Target URL for this delivery; passed through to the fetch implementation. */
  webhookUrl: string;
  /** Outbound request init (method, headers, body, abort signal). */
  init: RequestInit;
  /** Pinned/allowlisted fetch implementation that performs the actual network call. */
  fetchImplementation: WebhookDeliveryFetch;
}

/**
 * Send a webhook request through a per-webhook Opossum circuit breaker (50% error threshold
 * over a volume of 5 calls, 60s reset). Breakers are cached by internal webhook id in a bounded
 * LRU+TTL map so a flaky customer endpoint trips its own breaker without affecting others, while
 * URL churn and multi-tenant growth can no longer leak breakers (cap + idle eviction).
 *
 * @remarks
 * - **Algorithm:** resolve (or lazily create) the breaker for `webhookId`, then `fire` it with
 *   the URL/init/fetch so Opossum tracks failures per webhook.
 * - **Failure modes:** rejects with `EOPENBREAKER` when the breaker is open; otherwise propagates
 *   the underlying fetch error.
 * - **Side effects:** mutates the in-process breaker cache (create / touch / evict + `shutdown`).
 * - **Notes:** the cache is per-process; cross-process invalidation relies on the idle TTL.
 */
export async function fetchWebhookWithCircuitBreaker(
  options: FetchWebhookWithCircuitBreakerOptions,
): Promise<Response> {
  const { webhookId, webhookUrl, init, fetchImplementation } = options;
  return getWebhookOutboundCircuit(String(webhookId), webhookUrl).fire(
    webhookUrl,
    init,
    fetchImplementation,
  ) as Promise<Response>;
}

/**
 * Drop the cached breaker for a webhook (on update/delete) so stale state does not linger.
 *
 * @remarks
 * - **Algorithm:** look up the breaker by id, `shutdown()` it, and remove the cache entry.
 * - **Failure modes:** none — a missing entry is a no-op.
 * - **Side effects:** mutates the in-process breaker cache.
 * - **Notes:** invalidation is per-process (the API process that mutates the webhook differs
 *   from the worker process holding the live breaker), so the idle TTL is the durable
 *   cross-process safety net; this call is best-effort within a single process.
 */
export function invalidateWebhookOutboundCircuit(webhookId: number | string): void {
  const key = String(webhookId);
  const entry = circuitsByWebhookId.get(key);
  if (entry === undefined) return;
  entry.circuit.shutdown();
  circuitsByWebhookId.delete(key);
}

/**
 * Exponential backoff with up to 30% jitter (BullMQ custom backoff for webhook-delivery).
 *
 * @remarks
 * Jitter spreads simultaneous failures across worker concurrency slots so they don't all retry
 * on the same wall clock. It is drawn with `crypto.randomInt` (a CSPRNG): the backoff is computed
 * only once per failed delivery when BullMQ schedules the retry, so the secure draw's cost is
 * negligible, and sourcing it securely keeps the value unpredictable to an observer and satisfies
 * the static-analysis security gate (no `Math.random()` on the deployed surface).
 */
export function webhookDeliveryBackoffWithJitter(attemptsMade: number): number {
  const attemptIndex = Math.max(attemptsMade, 1);
  const baseDelayMs = TEN_SECONDS_MS * 2 ** (attemptIndex - 1);
  // randomInt(max) requires max >= 1; baseDelayMs * ratio is always well above 1 here, but clamp
  // defensively so the upper bound is never 0.
  const maxJitterMs = Math.max(1, Math.floor(baseDelayMs * WEBHOOK_DELIVERY_BACKOFF_JITTER_RATIO));
  const jitterMs = randomInt(maxJitterMs);
  return baseDelayMs + jitterMs;
}

/** Clears per-webhook circuits between tests (not for production use). */
export function resetWebhookOutboundCircuitsForTesting(): void {
  for (const entry of circuitsByWebhookId.values()) {
    entry.circuit.shutdown();
  }
  circuitsByWebhookId.clear();
}

/** Returns the current number of cached breakers (test/observability helper). */
export function getWebhookOutboundCircuitCacheSize(): number {
  return circuitsByWebhookId.size;
}
