import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import type { AuditService } from './audit.service.js';
import { AuditSerializer } from './audit.serializer.js';

/**
 * HTTP handlers for the admin audit-log routes. Thin layer that delegates to
 * {@link AuditService.listForAdmin} (cross-tenant read under an explicit
 * `app.global_admin` RLS context) and applies cursor-pagination response shaping.
 *
 * @remarks
 * sec-U4: when the listing query narrows to a specific subject (a single
 * `actor_user_id` and/or `organization_id`), the controller writes an
 * `audit.admin.read` audit row at WARNING severity so the platform records
 * "who watched whom." Unnarrowed global paging is not audited per-call —
 * request-log volume covers it and there is no specific target.
 */
export function createAuditController(service: AuditService) {
  return {
    listLogs: async (request: FastifyRequest, _reply: FastifyReply) => {
      const query = (request.query ?? {}) as {
        actor_user_id?: string;
        organization_id?: string;
      };
      const result = await service.listForAdmin(query as Record<string, unknown>);
      if (query.actor_user_id || query.organization_id) {
        const auth = requireAuth(request);
        await recordScopedAuditEvent(request, {
          actorUserPublicId: auth.userId,
          action: 'audit.admin.read',
          resource_type: 'audit_log',
          severity: 'WARNING',
          metadata: {
            ...(query.actor_user_id ? { target_actor_user_id: query.actor_user_id } : {}),
            ...(query.organization_id ? { target_organization_id: query.organization_id } : {}),
          },
        });
      }
      return paginatedResponse(
        AuditSerializer.many(result.items, result.resolution),
        getRequestIdentifier(request),
        {
          per_page: result.limit,
          next: result.next_cursor,
          has_more: result.has_more,
          ...(result.total !== null ? { estimated_total: result.total } : {}),
        },
      );
    },
  };
}
