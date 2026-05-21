import type { FastifyReply, FastifyRequest } from 'fastify';
import { applyCatalogCacheHeaders } from '@/shared/utils/http/http-cache.util.js';
import { paginatedResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier } from '@/shared/utils/http/request.util.js';
import type { PermissionService } from './permission.service.js';
import { serializePermission } from './permission.serializer.js';

export function createPermissionController(service: PermissionService) {
  return {
    listPermissions: async (request: FastifyRequest, reply: FastifyReply) => {
      const rows = await service.list();
      const data = rows.map(serializePermission);
      const payload = paginatedResponse(data, getRequestIdentifier(request), {
        per_page: data.length,
        next: null,
        has_more: false,
        estimated_total: data.length,
      });
      if (applyCatalogCacheHeaders(request, reply, payload)) {
        return reply;
      }
      return payload;
    },
  };
}
