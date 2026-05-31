import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

const getStateMock = vi.fn();

vi.mock('@/infrastructure/resilience/circuit-breaker.js', () => ({
  resendCircuit: { getState: getStateMock },
  stripeCircuit: { getState: getStateMock },
}));

describe('dlq-auto-retry-circuit.util', () => {
  beforeEach(() => {
    getStateMock.mockReset();
  });

  it('requires CLOSED state for mail (Resend circuit)', async () => {
    getStateMock.mockResolvedValueOnce('OPEN');
    const { isDeadLetterSourceQueueCircuitClosed } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry-circuit.util.js'
    );
    expect(await isDeadLetterSourceQueueCircuitClosed(MAIL_QUEUE_NAME)).toBe(false);

    getStateMock.mockResolvedValueOnce('CLOSED');
    expect(await isDeadLetterSourceQueueCircuitClosed(MAIL_QUEUE_NAME)).toBe(true);
  });

  it('requires CLOSED state for stripe-webhook', async () => {
    getStateMock.mockResolvedValueOnce('HALF_OPEN');
    const { isDeadLetterSourceQueueCircuitClosed } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry-circuit.util.js'
    );
    expect(await isDeadLetterSourceQueueCircuitClosed(STRIPE_WEBHOOK_QUEUE_NAME)).toBe(false);
  });

  it('treats webhook-delivery as always eligible (no cluster circuit)', async () => {
    const { isDeadLetterSourceQueueCircuitClosed } = await import(
      '@/infrastructure/queue/dlq/dlq-auto-retry-circuit.util.js'
    );
    expect(await isDeadLetterSourceQueueCircuitClosed(WEBHOOK_DELIVERY_QUEUE_NAME)).toBe(true);
    expect(getStateMock).not.toHaveBeenCalled();
  });
});
