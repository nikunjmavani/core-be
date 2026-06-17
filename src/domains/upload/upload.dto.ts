import { z } from 'zod';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';
import {
  UPLOAD_DTO_FILE_SIZE_MAX_BYTES,
  UPLOAD_PURPOSES,
  UPLOAD_TARGETS,
} from './upload.constants.js';

/**
 * Zod schema for the `POST /api/v1/uploads` request body — the structural
 * gate before {@link validateCreateUpload} applies purpose/MIME/size policies.
 *
 * @remarks
 * sec-UP3 is enforced at the validator layer (validateCreateUpload uses
 * `validatePublicIdParam` on `organization_id`) rather than the DTO so the
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
    organization_id: trimmedStringMinMax(1, 255).optional(),
    content_type: trimmedStringMinMax(1, 100),
    file_name: trimmedStringMinMax(1, 255),
    // sec-r4-I4: hard ceiling at the highest per-purpose cap. The validator
    // still applies the per-purpose maxSize below this (avatars are smaller
    // than user files, etc.); this `.max()` is a defense-in-depth gate so the
    // OpenAPI contract reflects the real upper bound and absurd / overflowing
    // claims are rejected before policy logic chooses a config row.
    file_size: z.number().int().positive().max(UPLOAD_DTO_FILE_SIZE_MAX_BYTES),
  })
  .strict();

/** Zod schema for the `:upload_id` URL param shared by the get/confirm/delete routes. */
export const uploadPublicIdParamDto = z.object({
  upload_id: trimmedStringMinMax(24, 28),
});
