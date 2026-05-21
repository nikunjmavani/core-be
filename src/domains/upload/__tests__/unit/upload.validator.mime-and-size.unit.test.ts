import { describe, it, expect } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateCreateUpload } from '@/domains/upload/upload.validator.js';
import { UPLOAD_PURPOSE_CONFIG } from '@/domains/upload/upload.constants.js';

describe('validateCreateUpload — MIME, size, and ownership', () => {
  const baseUserUpload = {
    for: 'user',
    purpose: 'avatar',
    contentType: 'image/jpeg',
    fileSize: 1024,
    fileName: 'avatar.jpg',
  };

  it('rejects MIME type not in purpose allowlist', () => {
    expect(() =>
      validateCreateUpload({ ...baseUserUpload, contentType: 'application/x-msdownload' }),
    ).toThrow(ValidationError);
  });

  it('rejects file size above purpose cap', () => {
    const maxSize = UPLOAD_PURPOSE_CONFIG.avatar.maxSize;
    expect(() => validateCreateUpload({ ...baseUserUpload, fileSize: maxSize + 1 })).toThrow(
      ValidationError,
    );
  });

  it('requires organizationId for organization-target uploads', () => {
    expect(() =>
      validateCreateUpload({
        for: 'organization',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        fileSize: 1024,
        fileName: 'logo.jpg',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects organizationId on user-target uploads', () => {
    expect(() =>
      validateCreateUpload({
        ...baseUserUpload,
        organizationId: 'org_public_abc',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts valid user-target upload within limits', () => {
    const result = validateCreateUpload(baseUserUpload);
    expect(result.purpose).toBe('avatar');
    expect(result.for).toBe('user');
  });
});
