import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import { createSubscriptionController } from '@/domains/billing/sub-domains/subscription/subscription.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';

const organizationPublicId = generatePublicId();
const subscriptionPublicId = generatePublicId();
const planPublicId = generatePublicId();

function buildRequest(overrides: Record<string, unknown> = {}): never {
  return {
    auth: { userId: generatePublicId(), role: 'user' },
    params: { id: organizationPublicId, subscriptionId: subscriptionPublicId },
    body: {},
    headers: {},
    id: 'request-id',
    ...overrides,
  } as never;
}

function buildReply(): FastifyReply {
  return {} as FastifyReply;
}

function buildService(): SubscriptionService {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    create: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    update: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    changePlan: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    cancel: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
    resume: vi.fn().mockResolvedValue({ public_id: subscriptionPublicId }),
  } as unknown as SubscriptionService;
}

describe('createSubscriptionController auth matrix', () => {
  let service: SubscriptionService;
  let controller: ReturnType<typeof createSubscriptionController>;

  beforeEach(() => {
    service = buildService();
    controller = createSubscriptionController(service);
  });

  it('createSubscription throws UnauthorizedError when request.auth is null', async () => {
    await expect(
      controller.createSubscription(
        buildRequest({
          auth: null as never,
          body: { plan_id: planPublicId, billing_cycle: 'monthly' },
        }),
        buildReply(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('updateSubscription throws UnauthorizedError when request.auth is null', async () => {
    await expect(
      controller.updateSubscription(
        buildRequest({ auth: null as never, body: { cancel_at_period_end: true } }),
        buildReply(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('cancelSubscription throws UnauthorizedError when request.auth is null', async () => {
    await expect(
      controller.cancelSubscription(buildRequest({ auth: null as never }), buildReply()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('resumeSubscription throws UnauthorizedError when request.auth is null', async () => {
    await expect(
      controller.resumeSubscription(buildRequest({ auth: null as never }), buildReply()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('changePlan throws UnauthorizedError when request.auth is null', async () => {
    await expect(
      controller.changePlan(
        buildRequest({ auth: null as never, body: { plan_id: planPublicId } }),
        buildReply(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(service.changePlan).not.toHaveBeenCalled();
  });

  it('mutating handlers throw ValidationError when organization public id param is invalid', async () => {
    const invalidParamRequest = () =>
      buildRequest({ params: { id: 'not-a-public-id', subscriptionId: subscriptionPublicId } });

    await expect(
      controller.createSubscription(invalidParamRequest(), buildReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.updateSubscription(invalidParamRequest(), buildReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.cancelSubscription(invalidParamRequest(), buildReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.resumeSubscription(invalidParamRequest(), buildReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.changePlan(invalidParamRequest(), buildReply())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.cancel).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
    expect(service.changePlan).not.toHaveBeenCalled();
  });
});
