import CircuitBreaker from 'opossum';
import type { WebhookDeliveryFetch } from '@/domains/notify/sub-domains/webhook/workers/webhook-delivery.worker.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const WEBHOOK_FETCH_TIMEOUT_MS = 30_000;

const circuitsByWebhookUrl = new Map<string, CircuitBreaker>();

async function executeWebhookFetch(
  webhookUrl: string,
  init: RequestInit,
  fetchImplementation: WebhookDeliveryFetch,
): Promise<Response> {
  return fetchImplementation(webhookUrl, init);
}

function attachCircuitEventListeners(circuit: CircuitBreaker, webhookUrl: string): void {
  circuit.on('open', () => {
    logger.warn({ webhookUrl }, 'webhook.outbound.circuit.open');
  });

  circuit.on('halfOpen', () => {
    logger.info({ webhookUrl }, 'webhook.outbound.circuit.half_open');
  });

  circuit.on('close', () => {
    logger.info({ webhookUrl }, 'webhook.outbound.circuit.closed');
  });
}

function getWebhookOutboundCircuit(webhookUrl: string): CircuitBreaker {
  const existing = circuitsByWebhookUrl.get(webhookUrl);
  if (existing) {
    return existing;
  }

  const circuit = new CircuitBreaker(executeWebhookFetch, {
    timeout: WEBHOOK_FETCH_TIMEOUT_MS + 5_000,
    errorThresholdPercentage: 50,
    resetTimeout: 60_000,
    volumeThreshold: 5,
    name: `webhook-outbound:${webhookUrl}`,
  });

  attachCircuitEventListeners(circuit, webhookUrl);
  circuitsByWebhookUrl.set(webhookUrl, circuit);
  return circuit;
}

/**
 * Send a webhook request through a per-URL Opossum circuit breaker (50% error threshold over a
 * volume of 5 calls, 60s reset). Reuses the same breaker for repeat calls to the same URL so
 * a flaky customer endpoint trips its own breaker without affecting others.
 */
export async function fetchWebhookWithCircuitBreaker(
  webhookUrl: string,
  init: RequestInit,
  fetchImplementation: WebhookDeliveryFetch,
): Promise<Response> {
  return getWebhookOutboundCircuit(webhookUrl).fire(
    webhookUrl,
    init,
    fetchImplementation,
  ) as Promise<Response>;
}

/**
 * Exponential backoff with up to 30% jitter (BullMQ custom backoff for webhook-delivery).
 */
export function webhookDeliveryBackoffWithJitter(attemptsMade: number): number {
  const attemptIndex = Math.max(attemptsMade, 1);
  const baseDelayMs = 10_000 * 2 ** (attemptIndex - 1);
  const jitterMs = Math.floor(Math.random() * baseDelayMs * 0.3);
  return baseDelayMs + jitterMs;
}

/** Clears per-URL circuits between tests (not for production use). */
export function resetWebhookOutboundCircuitsForTesting(): void {
  for (const circuit of circuitsByWebhookUrl.values()) {
    circuit.shutdown();
  }
  circuitsByWebhookUrl.clear();
}
