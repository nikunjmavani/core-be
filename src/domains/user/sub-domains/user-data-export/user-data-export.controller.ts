import type { FastifyRequest, FastifyReply } from 'fastify';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import type { UserDataExportService } from './user-data-export.service.js';
import { validateExportIdParam } from './user-data-export.validator.js';

/**
 * Build the GDPR export HTTP handler map (request/status). `requestExport` returns 202 because the
 * actual export runs asynchronously in a BullMQ worker; clients poll `getExportStatus` for the
 * presigned download URL once status flips to `completed`.
 */
export function createUserDataExportController(userDataExportService: UserDataExportService) {
  return {
    /**
     * POST /api/v1/users/me/data-export
     * GDPR: enqueue async export; poll GET :exportId for download URL.
     */
    async requestExport(request: FastifyRequest, reply: FastifyReply) {
      const requestId = getRequestIdentifier(request);
      const auth = requireAuth(request);
      const data = await userDataExportService.requestExport(auth.userId, { requestId });
      return reply.status(202).send(successResponse(data, requestId));
    },

    /**
     * GET /api/v1/users/me/data-export/:exportId
     */
    async getExportStatus(request: FastifyRequest, _reply: FastifyReply) {
      const requestId = getRequestIdentifier(request);
      const auth = requireAuth(request);
      const { exportId } = validateExportIdParam(request.params);
      const data = await userDataExportService.getExportStatus(auth.userId, exportId);
      return successResponse(data, requestId);
    },
  };
}
