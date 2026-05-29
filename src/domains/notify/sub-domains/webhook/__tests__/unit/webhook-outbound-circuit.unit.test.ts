import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWebhookWithCircuitBreaker,
  getWebhookOutboundCircuitCacheSize,
  invalidateWebhookOutboundCircuit,
  resetWebhookOutboundCircuitsForTesting,
  webhookDeliveryBackoffWithJitter,
} from '@/domains/notify/sub-domains/webhook/workers/webhook-outbound-circuit.js';

/** Mirrors WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES in webhook-outbound-circuit.ts. */
const WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES = 5_000;

describe('webhook-outbound-circuit', () => {
  afterEach(() => {
    resetWebhookOutboundCircuitsForTesting();
  });

  it('webhookDeliveryBackoffWithJitter returns base delay plus jitter for attempt 1', () => {
    const delayMs = webhookDeliveryBackoffWithJitter(1);
    expect(delayMs).toBeGreaterThanOrEqual(10_000);
    expect(delayMs).toBeLessThanOrEqual(13_000);
  });

  it('webhookDeliveryBackoffWithJitter returns base delay plus jitter for attempt 2', () => {
    const delayMs = webhookDeliveryBackoffWithJitter(2);
    expect(delayMs).toBeGreaterThanOrEqual(20_000);
    expect(delayMs).toBeLessThanOrEqual(26_000);
  });

  it('opens circuit for a failing webhook without affecting a healthy webhook', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('upstream_500'));
    const healthyFetch = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200, statusText: 'OK' }));

    for (let attemptIndex = 0; attemptIndex < 6; attemptIndex += 1) {
      await expect(
        fetchWebhookWithCircuitBreaker({
          webhookId: 1,
          webhookUrl: 'https://misbehaving.example/hook',
          init: { method: 'POST' },
          fetchImplementation: failingFetch,
        }),
      ).rejects.toThrow();
    }

    await expect(
      fetchWebhookWithCircuitBreaker({
        webhookId: 1,
        webhookUrl: 'https://misbehaving.example/hook',
        init: { method: 'POST' },
        fetchImplementation: failingFetch,
      }),
    ).rejects.toThrow(/breaker|open|EOPENBREAKER/i);

    const healthyResponse = await fetchWebhookWithCircuitBreaker({
      webhookId: 2,
      webhookUrl: 'https://healthy.example/hook',
      init: { method: 'POST' },
      fetchImplementation: healthyFetch,
    });

    expect(healthyResponse.status).toBe(200);
    expect(healthyFetch).toHaveBeenCalled();
  });

  it('reuses the same breaker across a webhook URL change (keyed by id, not URL)', async () => {
    const okFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    await fetchWebhookWithCircuitBreaker({
      webhookId: 42,
      webhookUrl: 'https://old.example/hook',
      init: { method: 'POST' },
      fetchImplementation: okFetch,
    });
    expect(getWebhookOutboundCircuitCacheSize()).toBe(1);

    await fetchWebhookWithCircuitBreaker({
      webhookId: 42,
      webhookUrl: 'https://new.example/hook',
      init: { method: 'POST' },
      fetchImplementation: okFetch,
    });

    // Same id → no new breaker created despite the URL change.
    expect(getWebhookOutboundCircuitCacheSize()).toBe(1);
  });

  it('invalidateWebhookOutboundCircuit drops the cached breaker for a webhook', async () => {
    const okFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    await fetchWebhookWithCircuitBreaker({
      webhookId: 7,
      webhookUrl: 'https://example.com/hook',
      init: { method: 'POST' },
      fetchImplementation: okFetch,
    });
    expect(getWebhookOutboundCircuitCacheSize()).toBe(1);

    invalidateWebhookOutboundCircuit(7);
    expect(getWebhookOutboundCircuitCacheSize()).toBe(0);

    // Invalidating an unknown id is a no-op.
    invalidateWebhookOutboundCircuit(9999);
    expect(getWebhookOutboundCircuitCacheSize()).toBe(0);
  });

  it('evicts the least-recently-used breaker once the cache cap is exceeded', async () => {
    const okFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    for (let webhookId = 0; webhookId < WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES; webhookId += 1) {
      await fetchWebhookWithCircuitBreaker({
        webhookId,
        webhookUrl: `https://example.com/hook/${String(webhookId)}`,
        init: { method: 'POST' },
        fetchImplementation: okFetch,
      });
    }
    expect(getWebhookOutboundCircuitCacheSize()).toBe(WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES);

    // One more distinct webhook id must evict the oldest entry, keeping the cache at the cap.
    await fetchWebhookWithCircuitBreaker({
      webhookId: WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES,
      webhookUrl: 'https://example.com/hook/overflow',
      init: { method: 'POST' },
      fetchImplementation: okFetch,
    });

    expect(getWebhookOutboundCircuitCacheSize()).toBe(WEBHOOK_CIRCUIT_CACHE_MAX_ENTRIES);
  });
});
