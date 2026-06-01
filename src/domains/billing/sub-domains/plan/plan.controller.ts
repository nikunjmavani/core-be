import type { FastifyReply, FastifyRequest } from 'fastify';
import { applyCatalogCacheHeaders } from '@/shared/utils/http/http-cache.util.js';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import type { PlanService } from './plan.service.js';
import { PlanSerializer } from './plan.serializer.js';
import { validateGetPlanParams } from './plan.validator.js';

/**
 * Builds the HTTP handlers for the public plan catalog (`/plans`, `/plans/:id`),
 * applying catalog cache headers on the list route so unchanged responses can
 * short-circuit with a 304.
 */
export function createPlanController(service: PlanService) {
  return {
    listPlans: async (request: FastifyRequest, reply: FastifyReply) => {
      const data = await service.list();
      const serialized = PlanSerializer.many(data);
      const payload = paginatedResponse(serialized, getRequestIdentifier(request), {
        per_page: serialized.length,
        next: null,
        has_more: false,
        estimated_total: serialized.length,
      });
      if (applyCatalogCacheHeaders(request, reply, payload)) {
        return reply;
      }
      return payload;
    },
    getPlan: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id } = validateGetPlanParams(request.params);
      const data = await service.getByPublicId(id);
      return successResponse(PlanSerializer.one(data), getRequestIdentifier(request));
    },
  };
}
