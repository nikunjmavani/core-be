import { describe, expect, it } from 'vitest';
import {
  UPLOAD_DTO_FILE_SIZE_MAX_BYTES,
  UPLOAD_PURPOSES,
  UPLOAD_TARGETS,
} from '@/domains/upload/upload.constants.js';
import { createUploadDto, uploadPublicIdParamDto } from '@/domains/upload/upload.dto.js';

/**
 * The first gate on the upload flow, and the one a malicious client meets before any policy code
 * runs. Two things here are load-bearing and were untested: the `file_size` ceiling (sec-r4-I4 —
 * a defense-in-depth bound so an absurd or overflowing claim is rejected BEFORE the per-purpose
 * config row is chosen) and `.strict()`, which stops a caller smuggling extra keys into the
 * presign request alongside a legitimate purpose.
 */
describe('upload.dto', () => {
  const validUpload = {
    purpose: UPLOAD_PURPOSES.AVATAR,
    for: UPLOAD_TARGETS.USER,
    content_type: 'image/png',
    file_name: 'avatar.png',
    file_size: 1024,
  };

  describe('createUploadDto — happy path', () => {
    it('accepts a well-formed avatar upload', () => {
      expect(createUploadDto.safeParse(validUpload).success).toBe(true);
    });

    it('accepts an optional organization_id', () => {
      const result = createUploadDto.safeParse({
        ...validUpload,
        purpose: UPLOAD_PURPOSES.ORGANIZATION_LOGO,
        for: UPLOAD_TARGETS.ORGANIZATION,
        organization_id: 'org_abcdefghijklmnopqrstu',
      });

      expect(result.success).toBe(true);
    });

    it('trims whitespace on the text fields', () => {
      const parsed = createUploadDto.parse({
        ...validUpload,
        content_type: '  image/png  ',
        file_name: '  avatar.png  ',
      });

      expect(parsed.content_type).toBe('image/png');
      expect(parsed.file_name).toBe('avatar.png');
    });
  });

  describe('purpose enum', () => {
    it.each(Object.values(UPLOAD_PURPOSES))('accepts the %s purpose', (purpose) => {
      expect(createUploadDto.safeParse({ ...validUpload, purpose }).success).toBe(true);
    });

    it.each([
      ['an unknown purpose', 'malware'],
      ['an empty purpose', ''],
      ['a differently-cased purpose', 'AVATAR'],
      ['a numeric purpose', 1],
      ['null', null],
    ])('rejects %s', (_label, purpose) => {
      expect(createUploadDto.safeParse({ ...validUpload, purpose }).success).toBe(false);
    });

    it('rejects a missing purpose', () => {
      const { purpose: _omitted, ...withoutPurpose } = validUpload;
      expect(createUploadDto.safeParse(withoutPurpose).success).toBe(false);
    });
  });

  describe('target (`for`) enum', () => {
    it.each(Object.values(UPLOAD_TARGETS))('accepts the %s target', (target) => {
      expect(createUploadDto.safeParse({ ...validUpload, for: target }).success).toBe(true);
    });

    it.each([
      ['an unknown target', 'system'],
      ['an empty target', ''],
      ['null', null],
    ])('rejects %s', (_label, target) => {
      expect(createUploadDto.safeParse({ ...validUpload, for: target }).success).toBe(false);
    });
  });

  describe('file_size ceiling (sec-r4-I4)', () => {
    it('accepts a size at exactly the documented maximum', () => {
      const result = createUploadDto.safeParse({
        ...validUpload,
        file_size: UPLOAD_DTO_FILE_SIZE_MAX_BYTES,
      });

      expect(result.success).toBe(true);
    });

    it('rejects one byte over the maximum', () => {
      const result = createUploadDto.safeParse({
        ...validUpload,
        file_size: UPLOAD_DTO_FILE_SIZE_MAX_BYTES + 1,
      });

      expect(result.success).toBe(false);
    });

    it.each([
      ['zero', 0],
      ['a negative size', -1],
      ['a fractional size', 1024.5],
      ['a string size', '1024'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ])('rejects %s', (_label, file_size) => {
      expect(createUploadDto.safeParse({ ...validUpload, file_size }).success).toBe(false);
    });

    it('accepts 1 byte as the smallest legitimate upload', () => {
      expect(createUploadDto.safeParse({ ...validUpload, file_size: 1 }).success).toBe(true);
    });
  });

  describe('file_name and content_type bounds', () => {
    it.each([
      ['an empty file_name', { file_name: '' }],
      ['a whitespace-only file_name', { file_name: '   ' }],
      ['a file_name over 255 characters', { file_name: 'a'.repeat(256) }],
      ['an empty content_type', { content_type: '' }],
      ['a content_type over 100 characters', { content_type: 'a'.repeat(101) }],
    ])('rejects %s', (_label, override) => {
      expect(createUploadDto.safeParse({ ...validUpload, ...override }).success).toBe(false);
    });

    it('accepts a file_name at exactly 255 characters', () => {
      const result = createUploadDto.safeParse({ ...validUpload, file_name: 'a'.repeat(255) });

      expect(result.success).toBe(true);
    });
  });

  describe('.strict() — no key smuggling into a presign request', () => {
    it.each([
      ['a storage key', { key: 'avatars/other-user/evil.png' }],
      ['a max size override', { max_size: 999_999_999 }],
      ['a bucket', { bucket: 'other-bucket' }],
      ['a user id', { user_id: 'usr_other' }],
      ['an id', { id: 1 }],
      ['a status', { status: 'CONFIRMED' }],
    ])('rejects %s riding along', (_label, extra) => {
      expect(createUploadDto.safeParse({ ...validUpload, ...extra }).success).toBe(false);
    });
  });

  describe('uploadPublicIdParamDto', () => {
    it('accepts a 24-character id (min boundary)', () => {
      expect(uploadPublicIdParamDto.safeParse({ upload_id: 'u'.repeat(24) }).success).toBe(true);
    });

    it('accepts a 28-character id (max boundary)', () => {
      expect(uploadPublicIdParamDto.safeParse({ upload_id: 'u'.repeat(28) }).success).toBe(true);
    });

    it.each([
      ['23 characters (under min)', 'u'.repeat(23)],
      ['29 characters (over max)', 'u'.repeat(29)],
      ['an empty id', ''],
    ])('rejects %s', (_label, upload_id) => {
      expect(uploadPublicIdParamDto.safeParse({ upload_id }).success).toBe(false);
    });

    it('rejects a missing id', () => {
      expect(uploadPublicIdParamDto.safeParse({}).success).toBe(false);
    });
  });
});
