import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createSubscriptionController } from '@/domains/billing/sub-domains/subscription/subscription.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): never {
  return {
    auth: { userId: generatePublicId(), role: 'user' },
    params: {},
    body: {},
    headers: {},
    id: 'request-id',
    ...overrides,
  } as never;
}

function mockReply(): FastifyReply {
  return {} as FastifyReply;
}

describe('createSubscriptionController', () => {
  const organizationPublicId = generatePublicId();
  const subscriptionPublicId = generatePublicId();
  const service = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    create: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    update: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    changePlan: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    cancel: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    resume: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
  } as unknown as SubscriptionService;

  const controller = createSubscriptionController(service);

  it('listSubscriptions delegates to service', async () => {
    const response = await controller.listSubscriptions(
      mockRequest({ params: { id: organizationPublicId } }),
      mockReply(),
    );
    expect(service.list).toHaveBeenCalledWith(organizationPublicId);
    expect(response).toMatchObject({ data: [] });
  });

  it('getSubscription delegates to service', async () => {
    await controller.getSubscription(
      mockRequest({ params: { id: organizationPublicId, subscriptionId: subscriptionPublicId } }),
      mockReply(),
    );
    expect(service.get).toHaveBeenCalledWith(organizationPublicId, subscriptionPublicId);
  });

  it('createSubscription passes idempotency key', async () => {
    await controller.createSubscription(
      mockRequest({
        params: { id: organizationPublicId },
        body: { plan_id: generatePublicId(), billing_cycle: 'monthly' },
        headers: { 'idempotency-key': 'idem-key-123456789012' },
      }),
      mockReply(),
    );
    expect(service.create).toHaveBeenCalled();
  });

  it('updateSubscription delegates to service', async () => {
    await controller.updateSubscription(
      mockRequest({
        params: { id: organizationPublicId, subscriptionId: subscriptionPublicId },
        body: { cancel_at_period_end: true },
      }),
      mockReply(),
    );
    expect(service.update).toHaveBeenCalled();
  });

  it('changePlan passes idempotency key to service', async () => {
    await controller.changePlan(
      mockRequest({
        params: { id: organizationPublicId, subscriptionId: subscriptionPublicId },
        body: { plan_id: generatePublicId() },
        headers: { 'idempotency-key': 'idem-key-123456789012' },
      }),
      mockReply(),
    );
    expect(service.changePlan).toHaveBeenCalledWith(
      organizationPublicId,
      subscriptionPublicId,
      expect.anything(),
      'idem-key-123456789012',
    );
  });

  it('cancelSubscription passes idempotency key to service', async () => {
    await controller.cancelSubscription(
      mockRequest({
        params: { id: organizationPublicId, subscriptionId: subscriptionPublicId },
        headers: { 'idempotency-key': 'idem-key-123456789012' },
      }),
      mockReply(),
    );
    expect(service.cancel).toHaveBeenCalledWith(
      organizationPublicId,
      subscriptionPublicId,
      'idem-key-123456789012',
    );
  });

  it('resumeSubscription passes idempotency key to service', async () => {
    await controller.resumeSubscription(
      mockRequest({
        params: { id: organizationPublicId, subscriptionId: subscriptionPublicId },
        headers: { 'idempotency-key': 'idem-key-123456789012' },
      }),
      mockReply(),
    );
    expect(service.resume).toHaveBeenCalledWith(
      organizationPublicId,
      subscriptionPublicId,
      'idem-key-123456789012',
    );
  });
});
