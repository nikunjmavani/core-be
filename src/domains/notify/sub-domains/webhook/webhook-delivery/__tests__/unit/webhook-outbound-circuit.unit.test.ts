import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWebhookWithCircuitBreaker,
  getWebhookOutboundCircuitCacheSize,
  invalidateWebhookOutboundCircuit,
  resetWebhookOutboundCircuitsForTesting,
  webhookDeliveryBackoffWithJitter,
} from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-outbound-circuit.js';

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

  it('evicts an idle breaker once the idle TTL has elapsed (time-based, distinct from the LRU cap)', async () => {
    // The LRU cap test above covers size-based eviction; the idle-TTL sweep (evictExpiredCircuits,
    // run on every access) is separate and was untested. Freeze Date.now — not useFakeTimers — so
    // opossum's own interval timers keep running while we control the breaker's lastAccessed clock.
    const okFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const IDLE_TTL_MS = 60 * 60 * 1000; // WEBHOOK_CIRCUIT_CACHE_IDLE_TTL_MS (1 hour)
    const base = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base);

    try {
      await fetchWebhookWithCircuitBreaker({
        webhookId: 100,
        webhookUrl: 'https://a.example/hook',
        init: { method: 'POST' },
        fetchImplementation: okFetch,
      });
      expect(getWebhookOutboundCircuitCacheSize()).toBe(1);

      // Advance past the idle TTL, then touch a DIFFERENT breaker so the sweep runs first.
      nowSpy.mockReturnValue(base + IDLE_TTL_MS + 1);
      await fetchWebhookWithCircuitBreaker({
        webhookId: 200,
        webhookUrl: 'https://b.example/hook',
        init: { method: 'POST' },
        fetchImplementation: okFetch,
      });

      // Breaker 100 was idle beyond the TTL and evicted; only 200 remains. Without idle eviction
      // this would be 2.
      expect(getWebhookOutboundCircuitCacheSize()).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
