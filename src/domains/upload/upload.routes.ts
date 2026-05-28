import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MODERATE_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit-presets.constants.js';
import { createUploadController } from './upload.controller.js';
import { createUploadDto } from './upload.dto.js';

/**
 * Fastify plugin mounting upload routes under the upload prefix: presigned URL
 * issue, metadata fetch, server-side confirm, and soft-delete. All routes
 * require authentication and share the moderate authed-user rate limit.
 */
export const uploadRoutesPlugin: FastifyPluginAsync = async (app) => {
  const controller = createUploadController(app.uploadDomain.uploadService);
  const zodApplication = app.withTypeProvider<ZodTypeProvider>();

  zodApplication.post(
    '/',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Request pre-signed upload URL',
        description:
          'Returns a pre-signed S3 URL for direct file upload. Specify the file purpose, content type, and size.',
        tags: ['Upload'],
        body: createUploadDto,
      },
    },
    controller.createUpload,
  );
  zodApplication.get(
    '/:publicId',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Get upload metadata',
        description:
          'Returns metadata for a previously requested upload owned by the authenticated user.',
        tags: ['Upload'],
      },
    },
    controller.getUpload,
  );
  zodApplication.post(
    '/:publicId/confirm',
    { onRequest: [app.authenticate], ...MODERATE_AUTHED_RATE_LIMIT },
    controller.confirmUpload,
  );
  zodApplication.delete(
    '/:publicId',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Delete upload',
        description:
          'Soft-deletes the upload record and removes the object from storage when possible.',
        tags: ['Upload'],
      },
    },
    controller.deleteUpload,
  );
};
