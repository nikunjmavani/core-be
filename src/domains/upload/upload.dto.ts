import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';
import { UPLOAD_PURPOSES, UPLOAD_TARGETS } from './upload.constants.js';

export const createUploadDto = z
  .object({
    purpose: z.enum([
      UPLOAD_PURPOSES.AVATAR,
      UPLOAD_PURPOSES.ORGANIZATION_LOGO,
      UPLOAD_PURPOSES.USER_FILE,
      UPLOAD_PURPOSES.ORGANIZATION_FILE,
    ]),
    for: z.enum([UPLOAD_TARGETS.USER, UPLOAD_TARGETS.ORGANIZATION]),
    organizationId: trimmedStringMinMax(1, 255).optional(),
    contentType: trimmedStringMinMax(1, 100),
    fileName: trimmedStringMinMax(1, 255),
    fileSize: z.number().int().positive(),
  })
  .strict();

export const uploadPublicIdParamDto = z.object({
  publicId: trimmedStringMinMax(21, 21),
});
