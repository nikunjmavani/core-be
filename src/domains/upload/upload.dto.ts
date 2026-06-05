import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';
import { UPLOAD_PURPOSES, UPLOAD_TARGETS } from './upload.constants.js';

/**
 * Zod schema for the `POST /api/v1/uploads` request body — the structural
 * gate before {@link validateCreateUpload} applies purpose/MIME/size policies.
 *
 * @remarks
 * sec-UP3: `organizationId` is constrained to the canonical 21-char
 * `PUBLIC_ID_REGEX` shape (was a generic 1-255 char string). The value flows
 * into S3 object keys and Redis cache keys; allowing arbitrary strings was a
 * cardinality / path-traversal amplification primitive that bypassed
 * defense-in-depth even though the existence check downstream made it
 * exploitable only on regression.
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
    organizationId: z.string().regex(PUBLIC_ID_REGEX).optional(),
    contentType: trimmedStringMinMax(1, 100),
    fileName: trimmedStringMinMax(1, 255),
    fileSize: z.number().int().positive(),
  })
  .strict();

/** Zod schema for the `:publicId` URL param shared by the get/confirm/delete routes. */
export const uploadPublicIdParamDto = z.object({
  publicId: trimmedStringMinMax(21, 21),
});
