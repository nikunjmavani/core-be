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

  /**
   * `user-file` and `organization-file` are 2 of the 4 purposes and appeared in this suite only
   * as incidental `file_key` strings in fixtures. They are the only purposes that admit
   * `application/pdf` and the only ones at the 10 MB cap, so both of the properties that make
   * them distinct from avatar/logo were unasserted.
   */
  describe('the file purposes (user-file / organization-file)', () => {
    const ORGANIZATION_PUBLIC_ID = 'org_abcdefghijklmnopqrstu';

    const baseOrganizationFile = {
      for: 'organization',
      purpose: 'organization-file',
      organization_id: ORGANIZATION_PUBLIC_ID,
      content_type: 'application/pdf',
      file_size: 1024,
      file_name: 'contract.pdf',
    };

    it('accepts application/pdf for user-file', () => {
      const result = validateCreateUpload({
        for: 'user',
        purpose: 'user-file',
        content_type: 'application/pdf',
        file_size: 1024,
        file_name: 'invoice.pdf',
      });

      expect(result.purpose).toBe('user-file');
      expect(result.content_type).toBe('application/pdf');
    });

    // The same content type must stay refused for avatar — a PDF served from the avatar
    // prefix is rendered inline by browsers and is not an image.
    it('rejects application/pdf for avatar', () => {
      expect(() =>
        validateCreateUpload({
          ...baseUserUpload,
          content_type: 'application/pdf',
          file_name: 'invoice.pdf',
        }),
      ).toThrow(ValidationError);
    });

    it('accepts a user-file exactly at the 10 MB cap and rejects one byte over', () => {
      const maxSize = UPLOAD_PURPOSE_CONFIG['user-file'].maxSize;
      const userFile = {
        for: 'user',
        purpose: 'user-file',
        content_type: 'application/pdf',
        file_name: 'invoice.pdf',
      };

      expect(validateCreateUpload({ ...userFile, file_size: maxSize }).file_size).toBe(maxSize);
      expect(() => validateCreateUpload({ ...userFile, file_size: maxSize + 1 })).toThrow(
        ValidationError,
      );
    });

    it('accepts an organization-file exactly at the 10 MB cap and rejects one byte over', () => {
      const maxSize = UPLOAD_PURPOSE_CONFIG['organization-file'].maxSize;

      expect(validateCreateUpload({ ...baseOrganizationFile, file_size: maxSize }).file_size).toBe(
        maxSize,
      );
      expect(() =>
        validateCreateUpload({ ...baseOrganizationFile, file_size: maxSize + 1 }),
      ).toThrow(ValidationError);
    });

    // route-audit L3: purpose↔target pairing. A user-target organization-file would build an
    // `organization-files/undefined/...` key on a user-scoped row.
    it('rejects organization-file on a user target', () => {
      expect(() =>
        validateCreateUpload({
          ...baseOrganizationFile,
          for: 'user',
          organization_id: undefined,
        }),
      ).toThrow(ValidationError);
    });

    it('rejects user-file on an organization target', () => {
      expect(() =>
        validateCreateUpload({
          ...baseOrganizationFile,
          purpose: 'user-file',
        }),
      ).toThrow(ValidationError);
    });
  });
});
