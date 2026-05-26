import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { successResponse } from '@/shared/utils/http/response.util.js';
import type { UploadService } from './upload.service.js';
import { validateCreateUpload } from './upload.validator.js';

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
      const publicId = (request.params as { publicId: string }).publicId;
      const result = await uploadService.getUpload(publicId, auth.userId);
      return reply.send(successResponse(result, getRequestIdentifier(request)));
    },

    confirmUpload: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const publicId = (request.params as { publicId: string }).publicId;
      const result = await uploadService.confirmUpload(publicId, auth.userId);
      return reply.send(successResponse(result, getRequestIdentifier(request)));
    },

    deleteUpload: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const publicId = (request.params as { publicId: string }).publicId;
      await uploadService.deleteUpload(publicId, auth.userId);
      return reply.code(204).send();
    },
  };
}
