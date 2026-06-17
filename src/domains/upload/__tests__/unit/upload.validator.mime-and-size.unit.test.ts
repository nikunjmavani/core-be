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
    content_type: 'image/jpeg',
    file_size: 1024,
    file_name: 'avatar.jpg',
  };

  it('rejects MIME type not in purpose allowlist', () => {
    expect(() =>
      validateCreateUpload({ ...baseUserUpload, content_type: 'application/x-msdownload' }),
    ).toThrow(ValidationError);
  });

  it('rejects file size above purpose cap', () => {
    const maxSize = UPLOAD_PURPOSE_CONFIG.avatar.maxSize;
    expect(() => validateCreateUpload({ ...baseUserUpload, file_size: maxSize + 1 })).toThrow(
      ValidationError,
    );
  });

  // sec-r4-I4: DTO-level cap rejects absurd values before the per-purpose
  // policy check runs. UPLOAD_DTO_FILE_SIZE_MAX_BYTES is the highest realistic
  // upload size (10 MB today, matching user_file / organization_file).
  it('rejects file_size above the DTO-level ceiling (sec-r4-I4)', () => {
    expect(() =>
      validateCreateUpload({ ...baseUserUpload, file_size: UPLOAD_DTO_FILE_SIZE_MAX_BYTES + 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects integer-overflow scale file_size at the DTO layer (sec-r4-I4)', () => {
    expect(() =>
      validateCreateUpload({ ...baseUserUpload, file_size: Number.MAX_SAFE_INTEGER }),
    ).toThrow(ValidationError);
  });

  it('requires organization_id for organization-target uploads', () => {
    expect(() =>
      validateCreateUpload({
        for: 'organization',
        purpose: 'avatar',
        content_type: 'image/jpeg',
        file_size: 1024,
        file_name: 'logo.jpg',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects organization_id on user-target uploads', () => {
    expect(() =>
      validateCreateUpload({
        ...baseUserUpload,
        organization_id: 'org_public_abc',
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
        content_type: 'image/png',
        file_name: 'evil.exe',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects uppercase mismatched extension (compared case-insensitively)', () => {
    expect(() =>
      validateCreateUpload({
        ...baseUserUpload,
        content_type: 'image/png',
        file_name: 'photo.JPG',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts .jpeg alias for image/jpeg', () => {
    const result = validateCreateUpload({
      ...baseUserUpload,
      content_type: 'image/jpeg',
      file_name: 'photo.jpeg',
    });
    expect(result.file_name).toBe('photo.jpeg');
  });

  it('accepts filename without an extension', () => {
    const result = validateCreateUpload({
      ...baseUserUpload,
      content_type: 'image/png',
      file_name: 'screenshot',
    });
    expect(result.file_name).toBe('screenshot');
  });
});
