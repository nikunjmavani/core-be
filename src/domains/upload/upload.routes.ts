import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MODERATE_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit-presets.constants.js';
import { createUploadController } from './upload.controller.js';
import { createUploadDto } from './upload.dto.js';

export const uploadRoutesPlugin: FastifyPluginAsync = async (app) => {
  const controller = createUploadController(app.uploadDomain.uploadService);
  const zodApplication = app.withTypeProvider<ZodTypeProvider>();

  zodApplication.post(
    '/',
    {
      onRequest: [app.authenticate],
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: { body: createUploadDto },
    },
    controller.createUpload,
  );
  zodApplication.get(
    '/:publicId',
    { onRequest: [app.authenticate], ...MODERATE_AUTHED_RATE_LIMIT },
    controller.getUpload,
  );
  zodApplication.post(
    '/:publicId/confirm',
    { onRequest: [app.authenticate], ...MODERATE_AUTHED_RATE_LIMIT },
    controller.confirmUpload,
  );
  zodApplication.delete(
    '/:publicId',
    { onRequest: [app.authenticate], ...MODERATE_AUTHED_RATE_LIMIT },
    controller.deleteUpload,
  );
};
