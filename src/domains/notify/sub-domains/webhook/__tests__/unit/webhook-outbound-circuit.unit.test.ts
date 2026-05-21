import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWebhookWithCircuitBreaker,
  resetWebhookOutboundCircuitsForTesting,
  webhookDeliveryBackoffWithJitter,
} from '@/domains/notify/sub-domains/webhook/workers/webhook-outbound-circuit.js';

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

  it('opens circuit for a failing webhook URL without affecting a healthy URL', async () => {
    const misbehavingWebhookUrl = 'https://misbehaving.example/hook';
    const healthyWebhookUrl = 'https://healthy.example/hook';

    const failingFetch = vi.fn().mockRejectedValue(new Error('upstream_500'));
    const healthyFetch = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200, statusText: 'OK' }));

    for (let attemptIndex = 0; attemptIndex < 6; attemptIndex += 1) {
      await expect(
        fetchWebhookWithCircuitBreaker(misbehavingWebhookUrl, { method: 'POST' }, failingFetch),
      ).rejects.toThrow();
    }

    await expect(
      fetchWebhookWithCircuitBreaker(misbehavingWebhookUrl, { method: 'POST' }, failingFetch),
    ).rejects.toThrow(/breaker|open|EOPENBREAKER/i);

    const healthyResponse = await fetchWebhookWithCircuitBreaker(
      healthyWebhookUrl,
      { method: 'POST' },
      healthyFetch,
    );

    expect(healthyResponse.status).toBe(200);
    expect(healthyFetch).toHaveBeenCalled();
  });
});
