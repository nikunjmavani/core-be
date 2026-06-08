import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';
import { UPLOAD_PURPOSES, UPLOAD_TARGETS } from './upload.constants.js';

/**
 * Zod schema for the `POST /api/v1/uploads` request body — the structural
 * gate before {@link validateCreateUpload} applies purpose/MIME/size policies.
 *
 * @remarks
 * sec-UP3 is enforced at the validator layer (validateCreateUpload uses
 * `validatePublicIdParam` on `organizationId`) rather than the DTO so the
 * OpenAPI contract remains a generic string — clients still pass the
 * canonical 21-char public id; the validator rejects anything else with a
 * ValidationError before the value reaches S3 keys / Redis cache keys.
 */
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

/** Zod schema for the `:publicId` URL param shared by the get/confirm/delete routes. */
export const uploadPublicIdParamDto = z.object({
  publicId: trimmedStringMinMax(21, 21),
});
