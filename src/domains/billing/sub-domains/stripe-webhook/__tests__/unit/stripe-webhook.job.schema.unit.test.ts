import { describe, expect, it } from 'vitest';
import { stripeWebhookJobDataSchema } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.job.schema.js';

describe('stripe-webhook.job.schema', () => {
  it('accepts minimal id-only BullMQ payload', () => {
    const parsed = stripeWebhookJobDataSchema.safeParse({
      stripeEventId: 'evt_123',
      requestId: 'req-abc',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ stripeEventId: 'evt_123', requestId: 'req-abc' });
    }
  });

  it('rejects payloads without stripeEventId', () => {
    expect(stripeWebhookJobDataSchema.safeParse({ requestId: 'req-abc' }).success).toBe(false);
  });
});
