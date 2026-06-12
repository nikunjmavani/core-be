import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createPlanController } from '@/domains/billing/sub-domains/plan/plan.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import { ValidationError } from '@/shared/errors/index.js';

describe('createPlanController', () => {
  const plan = { public_id: generatePublicId('plan'), name: 'Pro' };
  const service = {
    list: vi.fn().mockResolvedValue([plan]),
    getByPublicId: vi.fn().mockResolvedValue(plan),
  } as unknown as PlanService;

  const controller = createPlanController(service);

  const mockReply = (): FastifyReply =>
    ({
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    }) as unknown as FastifyReply;

  it('listPlans and getPlan delegate to service', async () => {
    const listResponse = await controller.listPlans(
      { id: 'req', query: {}, headers: {} } as FastifyRequest,
      mockReply(),
    );
    expect(listResponse).toMatchObject({ data: [plan] });

    await controller.getPlan(
      { id: 'req', params: { plan_id: plan.public_id } } as FastifyRequest,
      {} as FastifyReply,
    );
    expect(service.getByPublicId).toHaveBeenCalledWith(plan.public_id);
  });

  it('getPlan rejects missing or invalid id params via the validator', async () => {
    await expect(
      controller.getPlan({ id: 'req' } as FastifyRequest, {} as FastifyReply),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      controller.getPlan(
        { id: 'req', params: { plan_id: '' } } as FastifyRequest,
        {} as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('listPlans returns reply when If-None-Match matches catalog ETag', async () => {
    const reply = mockReply();
    const firstResponse = await controller.listPlans(
      { id: 'req-a', query: {}, headers: {} } as FastifyRequest,
      reply,
    );
    expect(firstResponse).toMatchObject({ data: [plan] });
    const etag = (reply.header as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === 'ETag',
    )?.[1];
    expect(etag).toBeDefined();

    const secondReply = mockReply();
    const secondResponse = await controller.listPlans(
      {
        id: 'req-b',
        query: {},
        headers: { 'if-none-match': String(etag) },
      } as FastifyRequest,
      secondReply,
    );
    expect(secondResponse).toBe(secondReply);
    expect(secondReply.status).toHaveBeenCalledWith(304);
    expect(secondReply.send).toHaveBeenCalled();
  });
});
