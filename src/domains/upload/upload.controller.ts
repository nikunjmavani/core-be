import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import type { UploadService } from './upload.service.js';
import { validateCreateUpload } from './upload.validator.js';

/**
 * HTTP handlers for the upload routes: request a presigned URL, fetch metadata,
 * confirm completion, and soft-delete an upload. All handlers are owner-scoped
 * via the authenticated user public id; ownership and permission checks live
 * inside {@link UploadService}.
 */
export function createUploadController(uploadService: UploadService) {
  return {
    createUpload: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const input = validateCreateUpload(request.body);
      const result = await uploadService.createUpload(input, auth.userId);
      return reply.status(201).send(successResponse(result, getRequestIdentifier(request)));
    },

    getUpload: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const publicId = (request.params as { upload_id: string }).upload_id;
      const result = await uploadService.getUpload(publicId, auth.userId);
      return reply.send(successResponse(result, getRequestIdentifier(request)));
    },

    confirmUpload: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const publicId = (request.params as { upload_id: string }).upload_id;
      const result = await uploadService.confirmUpload(publicId, auth.userId);
      return reply.send(successResponse(result, getRequestIdentifier(request)));
    },

    deleteUpload: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const publicId = (request.params as { upload_id: string }).upload_id;
      await uploadService.deleteUpload(publicId, auth.userId);
      return reply.code(204).send();
    },
  };
}
