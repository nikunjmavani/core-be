import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createStripeWebhookController } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.controller.js';

const queueMocks = vi.hoisted(() => ({
  enqueueStripeWebhook: vi.fn().mockResolvedValue(undefined),
}));

const repositoryMocks = vi.hoisted(() => ({
  tryClaimEvent: vi.fn().mockResolvedValue('claimed' as const),
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js', () => ({
  enqueueStripeWebhook: queueMocks.enqueueStripeWebhook,
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js', () => ({
  StripeWebhookEventRepository: class {
    tryClaimEvent = repositoryMocks.tryClaimEvent;
  },
}));

// sec-B finding #6: durability write is wrapped in withSystemTableWorkerContext —
// pass-through in tests so we can exercise the claim+enqueue ordering directly.
vi.mock('@/infrastructure/database/contexts/worker-database.context.js', () => ({
  withSystemTableWorkerContext: <T>(callback: () => Promise<T>) => callback(),
}));

type VerifiedEvent = { id: string; type: string; created?: number };

function buildRequest(
  event: VerifiedEvent | undefined,
  overrides: Partial<FastifyRequest> = {},
): FastifyRequest {
  return {
    id: 'request-replay-id',
    stripeWebhookEvent: event && { created: 1_750_000_000, ...event },
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
    repositoryMocks.tryClaimEvent.mockReset();
    repositoryMocks.tryClaimEvent.mockResolvedValue('claimed');
  });

  it('returns success acknowledgement when claim succeeds and enqueue succeeds', async () => {
    const event: VerifiedEvent = { id: 'evt_replay_1', type: 'customer.subscription.updated' };
    const reply = buildReply();

    const response = await controller.handleWebhook(buildRequest(event), reply);

    expect(repositoryMocks.tryClaimEvent).toHaveBeenCalledTimes(1);
    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledWith(
      expect.objectContaining(event),
      'request-replay-id',
    );
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

  it('still claims and enqueues each delivery for replayed event ids — downstream ledger dedups', async () => {
    // The controller no longer enforces dedup on its own — the ledger's `tryClaimEvent`
    // distinguishes `claimed` from `processed_duplicate` and only `claimed`/`reclaimed`
    // route to BullMQ. With both replays returning `claimed` (e.g. distinct event ids
    // that share metadata), both enqueue. The controller's job is durability+ordering.
    const eventA: VerifiedEvent = {
      id: 'evt_replay_dup_a',
      type: 'customer.subscription.updated',
    };
    const eventB: VerifiedEvent = {
      id: 'evt_replay_dup_b',
      type: 'customer.subscription.updated',
    };
    const requestA = buildRequest(eventA, { id: 'request-a' } as Partial<FastifyRequest>);
    const requestB = buildRequest(eventB, { id: 'request-b' } as Partial<FastifyRequest>);

    await controller.handleWebhook(requestA, buildReply());
    await controller.handleWebhook(requestB, buildReply());

    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledTimes(2);
    expect(queueMocks.enqueueStripeWebhook).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining(eventA),
      'request-a',
    );
    expect(queueMocks.enqueueStripeWebhook).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining(eventB),
      'request-b',
    );
  });

  it('forwards the request id through to the queue helper for replay correlation', async () => {
    const event: VerifiedEvent = { id: 'evt_replay_request_id', type: 'invoice.payment_failed' };
    const request = buildRequest(event, { id: 'correlate-me' } as Partial<FastifyRequest>);

    await controller.handleWebhook(request, buildReply());

    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledWith(
      expect.objectContaining(event),
      'correlate-me',
    );
  });

  it('passes the verified event object through without mutation', async () => {
    const event: VerifiedEvent = {
      id: 'evt_replay_identity',
      type: 'customer.subscription.deleted',
    };

    await controller.handleWebhook(buildRequest(event), buildReply());

    const [passedEvent] = queueMocks.enqueueStripeWebhook.mock.calls[0]!;
    expect(passedEvent).toMatchObject(event);
  });
});
