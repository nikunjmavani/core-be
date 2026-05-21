import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import type { AuditService } from './audit.service.js';
import { AuditSerializer } from './audit.serializer.js';

export function createAuditController(service: AuditService) {
  return {
    listLogs: async (request: FastifyRequest, _reply: FastifyReply) => {
      const result = await service.list(request.query as Record<string, unknown>);
      return paginatedResponse(AuditSerializer.many(result.items), getRequestIdentifier(request), {
        per_page: result.limit,
        next: result.page < result.total_pages ? String(result.page + 1) : null,
        has_more: result.page < result.total_pages,
        estimated_total: result.total,
      });
    },
  };
}
