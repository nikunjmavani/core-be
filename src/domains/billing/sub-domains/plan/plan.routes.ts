import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PlanService } from './plan.service.js';
import { createPlanController } from './plan.controller.js';
import { getPlanParamsDto } from './plan.dto.js';

/**
 * Fastify plugin factory that registers the public plan catalog endpoints
 * (`GET /plans`, `GET /plans/:plan_id`) backed by {@link PlanService}.
 */
export function planRoutes(service: PlanService): FastifyPluginAsync {
  const controller = createPlanController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/plans',
      {
        schema: {
          summary: 'List available plans',
          description:
            'Returns all active subscription plans with pricing and feature details. No authentication required.',
          tags: ['Plan'],
        },
      },
      controller.listPlans,
    );
    zodApplication.get<{ Params: { organization_id: string } }>(
      '/plans/:plan_id',
      {
        schema: {
          summary: 'Get plan details',
          description:
            'Returns a single plan with full pricing and feature information. No authentication required.',
          tags: ['Plan'],
          params: getPlanParamsDto,
        },
      },
      controller.getPlan,
    );
  };
}
