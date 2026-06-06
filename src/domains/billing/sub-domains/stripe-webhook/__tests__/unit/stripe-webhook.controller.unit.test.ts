import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createStripeWebhookController } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.controller.js';
import { ValidationError } from '@/shared/errors/index.js';

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

// sec-B finding #6: the controller now writes the ledger row inside
// `withSystemTableWorkerContext` BEFORE the 200 ACK. The context wrapper
// in production pins ALS for worker runtime; in API runtime it just passes
// through. Mock it as a pass-through here so the test exercises the claim+
// enqueue ordering without spinning up the database context machinery.
vi.mock('@/infrastructure/database/contexts/worker-database.context.js', () => ({
  withSystemTableWorkerContext: <T>(callback: () => Promise<T>) => callback(),
}));

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    id: 'request-id',
    ...overrides,
  } as FastifyRequest;
}

function mockReply(): FastifyReply {
  const reply = {
    status: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('createStripeWebhookController', () => {
  const controller = createStripeWebhookController();

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.tryClaimEvent.mockResolvedValue('claimed');
  });

  it('throws when stripeWebhookEvent is missing on the request', async () => {
    await expect(controller.handleWebhook(mockRequest(), mockReply())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repositoryMocks.tryClaimEvent).not.toHaveBeenCalled();
    expect(queueMocks.enqueueStripeWebhook).not.toHaveBeenCalled();
  });

  it('claims durably to Postgres FIRST, then enqueues to BullMQ, then ACKs Stripe', async () => {
    // sec-B finding #6: the ledger row is the durability commit. Prior code ACK'd Stripe
    // with `200 { received: true }` after only the BullMQ enqueue, so a Redis-side loss
    // between ingress and worker pickup permanently dropped the event. The fix moves
    // `tryClaimEvent` into the HTTP path BEFORE the 200 ACK; the reclaim cron sweeps
    // stuck rows back into BullMQ if the initial enqueue is lost.
    const verifiedEvent = {
      id: 'evt_1',
      type: 'customer.subscription.updated',
      created: 1_750_000_000,
    };
    const reply = mockReply();
    const response = await controller.handleWebhook(
      mockRequest({ stripeWebhookEvent: verifiedEvent as never }),
      reply,
    );

    expect(repositoryMocks.tryClaimEvent).toHaveBeenCalledWith({
      stripe_event_id: 'evt_1',
      event_type: 'customer.subscription.updated',
      stripe_created_at: new Date(1_750_000_000 * 1000),
      request_id: 'request-id',
    });
    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledWith(verifiedEvent, 'request-id');
    // Ordering invariant: the durability INSERT must happen before the BullMQ enqueue.
    expect(repositoryMocks.tryClaimEvent.mock.invocationCallOrder[0]).toBeLessThan(
      queueMocks.enqueueStripeWebhook.mock.invocationCallOrder[0]!,
    );
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(response).toMatchObject({
      data: { received: true },
      meta: { request_id: 'request-id' },
    });
  });

  it('skips the BullMQ enqueue when the event is already processed (idempotency)', async () => {
    repositoryMocks.tryClaimEvent.mockResolvedValueOnce('processed_duplicate');
    const verifiedEvent = {
      id: 'evt_dup',
      type: 'customer.subscription.updated',
      created: 1_750_000_000,
    };
    const reply = mockReply();
    const response = await controller.handleWebhook(
      mockRequest({ stripeWebhookEvent: verifiedEvent as never }),
      reply,
    );

    expect(repositoryMocks.tryClaimEvent).toHaveBeenCalledTimes(1);
    expect(queueMocks.enqueueStripeWebhook).not.toHaveBeenCalled();
    // We still ACK 200 so Stripe does not keep retrying a known-processed event.
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(response).toMatchObject({ data: { received: true } });
  });

  it('skips the BullMQ enqueue when another worker is still processing the event within its lease', async () => {
    repositoryMocks.tryClaimEvent.mockResolvedValueOnce('still_processing_within_lease');
    const verifiedEvent = {
      id: 'evt_inflight',
      type: 'customer.subscription.updated',
      created: 1_750_000_000,
    };
    const reply = mockReply();
    await controller.handleWebhook(
      mockRequest({ stripeWebhookEvent: verifiedEvent as never }),
      reply,
    );

    expect(queueMocks.enqueueStripeWebhook).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(200);
  });
});
