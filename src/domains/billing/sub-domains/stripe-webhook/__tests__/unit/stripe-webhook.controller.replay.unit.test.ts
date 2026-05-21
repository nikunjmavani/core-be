import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createStripeWebhookController } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.controller.js';

const queueMocks = vi.hoisted(() => ({
  enqueueStripeWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js', () => ({
  enqueueStripeWebhook: queueMocks.enqueueStripeWebhook,
}));

type VerifiedEvent = { id: string; type: string };

function buildRequest(
  event: VerifiedEvent | undefined,
  overrides: Partial<FastifyRequest> = {},
): FastifyRequest {
  return {
    id: 'request-replay-id',
    stripeWebhookEvent: event,
    ...overrides,
  } as unknown as FastifyRequest;
}

function buildReply(): FastifyReply {
  return {
    status: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

describe('createStripeWebhookController replay behavior', () => {
  const controller = createStripeWebhookController();

  beforeEach(() => {
    queueMocks.enqueueStripeWebhook.mockReset();
    queueMocks.enqueueStripeWebhook.mockResolvedValue(undefined);
  });

  it('returns success acknowledgement when service enqueues successfully', async () => {
    const event: VerifiedEvent = { id: 'evt_replay_1', type: 'customer.subscription.updated' };
    const reply = buildReply();

    const response = await controller.handleWebhook(buildRequest(event), reply);

    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledWith(event, 'request-replay-id');
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(response).toMatchObject({
      data: { received: true },
      meta: { request_id: 'request-replay-id' },
    });
  });

  it('rethrows enqueue failures so Stripe retries the delivery (no swallowing)', async () => {
    const event: VerifiedEvent = { id: 'evt_replay_2', type: 'invoice.paid' };
    queueMocks.enqueueStripeWebhook.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(controller.handleWebhook(buildRequest(event), buildReply())).rejects.toThrow(
      'redis unavailable',
    );
  });

  it('enqueues each delivery for replayed event ids (deduplication is enforced downstream, not at the controller)', async () => {
    const event: VerifiedEvent = { id: 'evt_replay_dup', type: 'customer.subscription.updated' };
    const requestA = buildRequest(event, { id: 'request-a' } as Partial<FastifyRequest>);
    const requestB = buildRequest(event, { id: 'request-b' } as Partial<FastifyRequest>);

    await controller.handleWebhook(requestA, buildReply());
    await controller.handleWebhook(requestB, buildReply());

    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledTimes(2);
    expect(queueMocks.enqueueStripeWebhook).toHaveBeenNthCalledWith(1, event, 'request-a');
    expect(queueMocks.enqueueStripeWebhook).toHaveBeenNthCalledWith(2, event, 'request-b');
  });

  it('forwards the request id through to the queue helper for replay correlation', async () => {
    const event: VerifiedEvent = { id: 'evt_replay_request_id', type: 'invoice.payment_failed' };
    const request = buildRequest(event, { id: 'correlate-me' } as Partial<FastifyRequest>);

    await controller.handleWebhook(request, buildReply());

    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledWith(event, 'correlate-me');
  });

  it('passes the verified event object through without mutation', async () => {
    const event: VerifiedEvent = {
      id: 'evt_replay_identity',
      type: 'customer.subscription.deleted',
    };

    await controller.handleWebhook(buildRequest(event), buildReply());

    const [passedEvent] = queueMocks.enqueueStripeWebhook.mock.calls[0]!;
    expect(passedEvent).toBe(event);
    expect(passedEvent).toEqual({
      id: 'evt_replay_identity',
      type: 'customer.subscription.deleted',
    });
  });
});
