import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createStripeWebhookController } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.controller.js';
import { ValidationError } from '@/shared/errors/index.js';

const queueMocks = vi.hoisted(() => ({
  enqueueStripeWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js', () => ({
  enqueueStripeWebhook: queueMocks.enqueueStripeWebhook,
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
  });

  it('throws when stripeWebhookEvent is missing on the request', async () => {
    await expect(controller.handleWebhook(mockRequest(), mockReply())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(queueMocks.enqueueStripeWebhook).not.toHaveBeenCalled();
  });

  it('enqueues verified events and returns received payload', async () => {
    const verifiedEvent = {
      id: 'evt_1',
      type: 'customer.subscription.updated',
    };
    const reply = mockReply();
    const response = await controller.handleWebhook(
      mockRequest({ stripeWebhookEvent: verifiedEvent as never }),
      reply,
    );

    expect(queueMocks.enqueueStripeWebhook).toHaveBeenCalledWith(verifiedEvent, 'request-id');
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(response).toMatchObject({
      data: { received: true },
      meta: { request_id: 'request-id' },
    });
  });
});
