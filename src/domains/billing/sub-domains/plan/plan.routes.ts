import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PlanService } from './plan.service.js';
import { createPlanController } from './plan.controller.js';
import { getPlanParamsDto } from './plan.dto.js';

export function planRoutes(service: PlanService): FastifyPluginAsync {
  const controller = createPlanController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get('/plans', { schema: {} }, controller.listPlans);
    zodApplication.get<{ Params: { id: string } }>(
      '/plans/:id',
      { schema: { params: getPlanParamsDto } },
      controller.getPlan,
    );
  };
}
