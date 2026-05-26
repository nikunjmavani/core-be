import { env } from '@/shared/config/env.config.js';
import { UPLOAD_PURPOSE_CONFIG, type UploadPurpose } from './upload.constants.js';
import { SVG_CONTENT_TYPE } from './upload-svg.util.js';

/**
 * Maps an allowed content type to the filename extensions that are permitted for it.
 * The first entry is the canonical extension used when generating S3 keys; subsequent
 * entries are accepted aliases when validating a client-declared filename (e.g. `.jpeg`
 * for `image/jpeg`). All extensions include the leading dot and are lowercase.
 */
export const CONTENT_TYPE_TO_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
  'application/pdf': ['.pdf'],
} as const;

export function getAllowedContentTypesForPurpose(purpose: UploadPurpose): readonly string[] {
  // eslint-disable-next-line security/detect-object-injection -- purpose is a UploadPurpose enum key.
  const baseTypes = UPLOAD_PURPOSE_CONFIG[purpose].allowedTypes;
  if (!env.UPLOAD_ALLOW_SVG) {
    return baseTypes;
  }

  const hasImageType = baseTypes.some((contentType) => contentType.startsWith('image/'));
  if (!hasImageType || baseTypes.includes(SVG_CONTENT_TYPE)) {
    return baseTypes;
  }

  return [...baseTypes, SVG_CONTENT_TYPE];
}

/** Returns the lowercase, accepted filename extensions for a content type (empty when unknown). */
export function getAllowedExtensionsForContentType(contentType: string): readonly string[] {
  // eslint-disable-next-line security/detect-object-injection -- key sourced from validator allowlist
  return CONTENT_TYPE_TO_EXTENSIONS[contentType] ?? [];
}

/** Returns the canonical filename extension for a content type (empty when unknown). */
export function getCanonicalExtensionForContentType(contentType: string): string {
  return getAllowedExtensionsForContentType(contentType)[0] ?? '';
}
