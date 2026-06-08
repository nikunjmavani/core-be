import { describe, it, expect } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateCreateUpload } from '@/domains/upload/upload.validator.js';
import {
  UPLOAD_DTO_FILE_SIZE_MAX_BYTES,
  UPLOAD_PURPOSE_CONFIG,
} from '@/domains/upload/upload.constants.js';

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

  // sec-r4-I4: DTO-level cap rejects absurd values before the per-purpose
  // policy check runs. UPLOAD_DTO_FILE_SIZE_MAX_BYTES is the highest realistic
  // upload size (10 MB today, matching user_file / organization_file).
  it('rejects fileSize above the DTO-level ceiling (sec-r4-I4)', () => {
    expect(() =>
      validateCreateUpload({ ...baseUserUpload, fileSize: UPLOAD_DTO_FILE_SIZE_MAX_BYTES + 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects integer-overflow scale fileSize at the DTO layer (sec-r4-I4)', () => {
    expect(() =>
      validateCreateUpload({ ...baseUserUpload, fileSize: Number.MAX_SAFE_INTEGER }),
    ).toThrow(ValidationError);
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

  it('rejects filename extension that does not match content type', () => {
    expect(() =>
      validateCreateUpload({
        ...baseUserUpload,
        contentType: 'image/png',
        fileName: 'evil.exe',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects uppercase mismatched extension (compared case-insensitively)', () => {
    expect(() =>
      validateCreateUpload({
        ...baseUserUpload,
        contentType: 'image/png',
        fileName: 'photo.JPG',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts .jpeg alias for image/jpeg', () => {
    const result = validateCreateUpload({
      ...baseUserUpload,
      contentType: 'image/jpeg',
      fileName: 'photo.jpeg',
    });
    expect(result.fileName).toBe('photo.jpeg');
  });

  it('accepts filename without an extension', () => {
    const result = validateCreateUpload({
      ...baseUserUpload,
      contentType: 'image/png',
      fileName: 'screenshot',
    });
    expect(result.fileName).toBe('screenshot');
  });
});
