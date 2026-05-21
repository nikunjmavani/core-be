import { env } from '@/shared/config/env.config.js';
import { UPLOAD_PURPOSE_CONFIG, type UploadPurpose } from './upload.constants.js';
import { SVG_CONTENT_TYPE } from './upload-svg.util.js';

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
