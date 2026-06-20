import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MODERATE_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { createUploadController } from './upload.controller.js';
import { createUploadDto, uploadPublicIdParamDto } from './upload.dto.js';

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
      config: { idempotencyRequired: true, ...MODERATE_AUTHED_RATE_LIMIT.config },
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
    '/:upload_id',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Get upload metadata',
        description:
          'Returns metadata for a previously requested upload owned by the authenticated user.',
        tags: ['Upload'],
        params: uploadPublicIdParamDto,
      },
    },
    controller.getUpload,
  );
  zodApplication.post(
    '/:upload_id/confirm',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Confirm uploaded object',
        description:
          'Confirms a previously requested upload after the client has PUT the file to the pre-signed URL. Verifies the object exists in storage and marks the upload record complete.',
        tags: ['Upload'],
        params: uploadPublicIdParamDto,
      },
    },
    controller.confirmUpload,
  );
  zodApplication.delete(
    '/:upload_id',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Delete upload',
        description:
          'Soft-deletes the upload record and removes the object from storage when possible.',
        tags: ['Upload'],
        params: uploadPublicIdParamDto,
      },
    },
    controller.deleteUpload,
  );
};
