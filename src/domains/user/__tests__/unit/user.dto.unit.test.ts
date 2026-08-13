import { describe, expect, it } from 'vitest';
import {
  dataExportIdParamsDto,
  UpdateMeDto,
  UploadAvatarDto,
  userIdParamsDto,
} from '@/domains/user/user.dto.js';

/**
 * The self-service profile schemas. `avatar_key` is the security-relevant field and the reason
 * this suite exists: the client sends a storage key it claims to have uploaded to, and two
 * `.refine()` guards stand between that claim and the object store — a prefix check confining it
 * to `avatars/`, and a traversal check rejecting `..` and control characters. Drop either and a
 * caller can point their avatar at an arbitrary key in the bucket.
 */
describe('user.dto', () => {
  describe('UpdateMeDto — avatar_key guards', () => {
    it('accepts a well-formed avatar key', () => {
      expect(UpdateMeDto.safeParse({ avatar_key: 'avatars/usr_abc/photo.png' }).success).toBe(true);
    });

    it.each([
      ['a key outside the avatars prefix', 'organization-logos/other/logo.png'],
      ['a bare filename', 'photo.png'],
      ['a leading slash', '/avatars/usr_abc/photo.png'],
      ['an absolute-looking path', '/etc/passwd'],
      ['a prefix that only starts similarly', 'avatars-evil/photo.png'],
    ])('rejects %s', (_label, avatar_key) => {
      expect(UpdateMeDto.safeParse({ avatar_key }).success).toBe(false);
    });

    it.each([
      ['a parent-directory segment', 'avatars/../organization-logos/logo.png'],
      ['a nested traversal', 'avatars/usr_abc/../../secrets.png'],
      ['a trailing traversal', 'avatars/usr_abc/..'],
    ])('rejects %s (path traversal)', (_label, avatar_key) => {
      expect(UpdateMeDto.safeParse({ avatar_key }).success).toBe(false);
    });

    it('rejects a key carrying a control character', () => {
      expect(UpdateMeDto.safeParse({ avatar_key: 'avatars/usr\u0000/photo.png' }).success).toBe(
        false,
      );
    });

    it('rejects a key over 512 characters', () => {
      const tooLong = `avatars/${'a'.repeat(512)}`;

      expect(UpdateMeDto.safeParse({ avatar_key: tooLong }).success).toBe(false);
    });

    it('does NOT accept null for avatar_key (unlike the nullable name fields)', () => {
      expect(UpdateMeDto.safeParse({ avatar_key: null }).success).toBe(false);
    });
  });

  describe('UpdateMeDto — profile fields', () => {
    it('accepts an empty object (every field is optional)', () => {
      expect(UpdateMeDto.safeParse({}).success).toBe(true);
    });

    it.each(['first_name', 'last_name', 'job_title'])('accepts null to clear %s', (field) => {
      expect(UpdateMeDto.safeParse({ [field]: null }).success).toBe(true);
    });

    it.each([
      ['first_name over 100 characters', { first_name: 'a'.repeat(101) }],
      ['last_name over 100 characters', { last_name: 'a'.repeat(101) }],
      ['job_title over 150 characters', { job_title: 'a'.repeat(151) }],
    ])('rejects %s', (_label, input) => {
      expect(UpdateMeDto.safeParse(input).success).toBe(false);
    });

    it.each([
      ['first_name at 100', { first_name: 'a'.repeat(100) }],
      ['job_title at 150', { job_title: 'a'.repeat(150) }],
    ])('accepts %s (max boundary)', (_label, input) => {
      expect(UpdateMeDto.safeParse(input).success).toBe(true);
    });

    it('trims surrounding whitespace', () => {
      expect(UpdateMeDto.parse({ first_name: '  Ada  ' }).first_name).toBe('Ada');
    });

    it.each([
      ['an email change', { email: 'new@example.com' }],
      ['a role', { role: 'super_admin' }],
      ['a global role', { global_role: 'admin' }],
      ['a status', { status: 'ACTIVE' }],
      ['an id', { id: 1 }],
      ['a password', { password: 'hunter22' }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      // Self-service profile update is not the place to change identity, role or credentials.
      expect(UpdateMeDto.safeParse(extra).success).toBe(false);
    });
  });

  describe('UploadAvatarDto', () => {
    it('accepts a well-formed avatar key', () => {
      expect(UploadAvatarDto.safeParse({ avatar_key: 'avatars/usr_abc/photo.png' }).success).toBe(
        true,
      );
    });

    it('applies the same prefix guard as UpdateMeDto', () => {
      expect(UploadAvatarDto.safeParse({ avatar_key: 'user-files/evil.png' }).success).toBe(false);
    });

    it('applies the same traversal guard as UpdateMeDto', () => {
      expect(UploadAvatarDto.safeParse({ avatar_key: 'avatars/../evil.png' }).success).toBe(false);
    });
  });

  describe('id param schemas', () => {
    it.each([
      ['userIdParamsDto', userIdParamsDto, 'user_id'],
      ['dataExportIdParamsDto', dataExportIdParamsDto, 'data_export_id'],
    ] as const)('%s accepts a well-formed id', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: 'usr_abcdefghijklmnopqrst' }).success).toBe(true);
    });

    it.each([
      ['userIdParamsDto', userIdParamsDto, 'user_id'],
      ['dataExportIdParamsDto', dataExportIdParamsDto, 'data_export_id'],
    ] as const)('%s rejects empty, oversized and unknown params', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: '' }).success).toBe(false);
      expect(schema.safeParse({ [field]: 'a'.repeat(29) }).success).toBe(false);
      expect(schema.safeParse({ [field]: 'usr_abc', injected: 'x' }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    });
  });
});
