import { z } from 'zod';
import path from 'node:path';
import { ValidationError } from '@/shared/errors/index.js';
import { createUploadDto, uploadPublicIdParamDto } from './upload.dto.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import { UPLOAD_PURPOSE_CONFIG, UPLOAD_TARGETS } from './upload.constants.js';
import {
  getAllowedContentTypesForPurpose,
  getAllowedExtensionsForContentType,
} from './utils/upload-content-type.util.js';
import type { CreateUploadInput } from './upload.types.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/**
 * Validates the request body for `POST /api/v1/uploads`: structure via
 * {@link createUploadDto}, then policy checks for `organizationId`
 * presence/absence per target, allowed content type for the purpose, declared
 * filename extension matching the content type, and size against
 * {@link UPLOAD_PURPOSE_CONFIG}. Throws {@link ValidationError} on any failure.
 */
export function validateCreateUpload(data: unknown): CreateUploadInput {
  const result = createUploadDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidUploadInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }

  const input = result.data;
  const config = UPLOAD_PURPOSE_CONFIG[input.purpose];
  const allowedTypes = getAllowedContentTypesForPurpose(input.purpose);

  // Ownership validation
  if (input.for === UPLOAD_TARGETS.USER && input.organizationId) {
    throw new ValidationError('errors:uploadOrganizationIdNotAllowed', undefined, undefined, [
      { field: 'organizationId', messageKey: 'errors:uploadOrganizationIdNotAllowed' },
    ]);
  }
  if (input.for === UPLOAD_TARGETS.ORGANIZATION && !input.organizationId) {
    throw new ValidationError('errors:uploadOrganizationIdRequired', undefined, undefined, [
      { field: 'organizationId', messageKey: 'errors:uploadOrganizationIdRequired' },
    ]);
  }

  // Content type validation
  if (!allowedTypes.includes(input.contentType)) {
    throw new ValidationError(
      'errors:uploadContentTypeNotAllowed',
      {
        contentType: input.contentType,
        purpose: input.purpose,
        allowed: allowedTypes.join(', '),
      },
      undefined,
      [
        {
          field: 'contentType',
          messageKey: 'errors:uploadContentTypeNotAllowed',
          messageParams: {
            contentType: input.contentType,
            purpose: input.purpose,
            allowed: allowedTypes.join(', '),
          },
        },
      ],
    );
  }

  // Filename extension validation — declared filename extension must match the declared
  // content type (when the filename includes an extension). Prevents misleading filenames
  // (e.g. evil.exe with contentType=image/png) from being stored against an allowed type.
  const allowedExtensions = getAllowedExtensionsForContentType(input.contentType);
  const declaredExtension = path.extname(input.fileName).toLowerCase();
  if (declaredExtension !== '' && !allowedExtensions.includes(declaredExtension)) {
    throw new ValidationError(
      'errors:uploadFilenameExtensionMismatch',
      {
        extension: declaredExtension,
        contentType: input.contentType,
        allowed: allowedExtensions.join(', '),
      },
      undefined,
      [
        {
          field: 'fileName',
          messageKey: 'errors:uploadFilenameExtensionMismatch',
          messageParams: {
            extension: declaredExtension,
            contentType: input.contentType,
            allowed: allowedExtensions.join(', '),
          },
        },
      ],
    );
  }

  // File size validation
  if (input.fileSize > config.maxSize) {
    throw new ValidationError(
      'errors:uploadFileSizeExceeded',
      { fileSize: input.fileSize, maxSize: config.maxSize, purpose: input.purpose },
      undefined,
      [
        {
          field: 'fileSize',
          messageKey: 'errors:uploadFileSizeExceeded',
          messageParams: {
            fileSize: input.fileSize,
            maxSize: config.maxSize,
            purpose: input.purpose,
          },
        },
      ],
    );
  }

  return omitUndefined(input);
}

/**
 * Validates the `:publicId` URL param against {@link uploadPublicIdParamDto}
 * and the shared public-id format check; returns the normalized public id.
 */
export function validateUploadPublicIdParam(public_id: string): string {
  const parsed = uploadPublicIdParamDto.safeParse({ publicId: public_id });
  if (!parsed.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(parsed.error).fieldErrors,
    );
  }
  return validatePublicIdParam(parsed.data.publicId, 'publicId');
}
