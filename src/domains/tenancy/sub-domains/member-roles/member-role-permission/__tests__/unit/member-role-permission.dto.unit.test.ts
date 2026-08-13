import { describe, expect, it } from 'vitest';
import { putMemberRolePermissionsDto } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.dto.js';

/**
 * `PUT /organization/roles/:role_id/permissions` has REPLACE semantics — the submitted array
 * becomes the role's entire permission set, it is not appended to it. That makes two properties of
 * this schema security-relevant in opposite directions.
 *
 * `.min(0)` is deliberate: an empty array is the documented way to strip a role back to nothing.
 * If a future edit "hardened" that to `.min(1)`, the only way to revoke a role's last permission
 * would be to delete the role, and callers would be stuck with a privilege they cannot remove.
 *
 * `.max(200)` and the per-code length cap are the other direction: the body is fully caller-
 * controlled and each code becomes a row, so an unbounded array is a cheap write amplifier.
 */
describe('member-role-permission.dto', () => {
  describe('replace semantics', () => {
    it('accepts an empty array — the documented way to revoke every permission', () => {
      expect(putMemberRolePermissionsDto.safeParse({ permission_codes: [] }).success).toBe(true);
    });

    it('accepts a single code', () => {
      expect(
        putMemberRolePermissionsDto.safeParse({ permission_codes: ['organization:read'] }).success,
      ).toBe(true);
    });

    it('requires the permission_codes field (an omitted body is not an empty set)', () => {
      // Replace semantics make the distinction matter: omitting the field must not be read as
      // "replace with nothing".
      expect(putMemberRolePermissionsDto.safeParse({}).success).toBe(false);
    });

    it('rejects null for permission_codes', () => {
      expect(putMemberRolePermissionsDto.safeParse({ permission_codes: null }).success).toBe(false);
    });

    it('rejects a bare string instead of an array', () => {
      expect(
        putMemberRolePermissionsDto.safeParse({ permission_codes: 'organization:read' }).success,
      ).toBe(false);
    });

    it('preserves duplicate codes for the service to reconcile', () => {
      // The schema does not de-duplicate; pinned so a reader knows set semantics are applied
      // downstream, not here.
      const result = putMemberRolePermissionsDto.parse({
        permission_codes: ['organization:read', 'organization:read'],
      });

      expect(result.permission_codes).toEqual(['organization:read', 'organization:read']);
    });
  });

  describe('bounds', () => {
    it('accepts 200 codes', () => {
      const permission_codes = Array.from({ length: 200 }, (_value, index) => `perm:${index}`);

      expect(putMemberRolePermissionsDto.safeParse({ permission_codes }).success).toBe(true);
    });

    it('rejects 201 codes', () => {
      const permission_codes = Array.from({ length: 201 }, (_value, index) => `perm:${index}`);

      expect(putMemberRolePermissionsDto.safeParse({ permission_codes }).success).toBe(false);
    });

    it('accepts a code at 100 characters', () => {
      expect(
        putMemberRolePermissionsDto.safeParse({ permission_codes: ['a'.repeat(100)] }).success,
      ).toBe(true);
    });

    it('rejects a code over 100 characters', () => {
      expect(
        putMemberRolePermissionsDto.safeParse({ permission_codes: ['a'.repeat(101)] }).success,
      ).toBe(false);
    });

    it.each([
      ['an empty code', ''],
      ['a whitespace-only code', '   '],
    ])('rejects %s', (_label, code) => {
      // Whitespace-only trims to empty and fails min(1) — otherwise a blank row reaches the table.
      expect(putMemberRolePermissionsDto.safeParse({ permission_codes: [code] }).success).toBe(
        false,
      );
    });

    it('trims each code', () => {
      const result = putMemberRolePermissionsDto.parse({
        permission_codes: ['  organization:read  '],
      });

      expect(result.permission_codes).toEqual(['organization:read']);
    });

    it.each([
      ['a number', 42],
      ['null', null],
      ['a nested array', ['organization:read']],
      ['an object', { code: 'organization:read' }],
    ])('rejects %s as an array element', (_label, element) => {
      expect(putMemberRolePermissionsDto.safeParse({ permission_codes: [element] }).success).toBe(
        false,
      );
    });

    it('rejects one bad code among many valid ones', () => {
      // All-or-nothing: a partially applied permission set is worse than a rejected request.
      const permission_codes = ['organization:read', 'a'.repeat(101), 'organization:write'];

      expect(putMemberRolePermissionsDto.safeParse({ permission_codes }).success).toBe(false);
    });
  });

  describe('mass-assignment boundary', () => {
    it.each([
      ['a role id', { role_id: 'rol_other' }],
      ['an organization id', { organization_id: 'org_other' }],
      ['an is_system flag', { is_system: true }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      expect(
        putMemberRolePermissionsDto.safeParse({ permission_codes: [], ...extra }).success,
      ).toBe(false);
    });
  });
});
