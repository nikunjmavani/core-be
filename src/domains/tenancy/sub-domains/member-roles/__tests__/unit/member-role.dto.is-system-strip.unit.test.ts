import { describe, it, expect } from 'vitest';
import { createMemberRoleDto } from '@/domains/tenancy/sub-domains/member-roles/member-role.dto.js';

/**
 * Regression for sec-T3 (High): `createMemberRoleDto` must NOT accept `is_system: true`
 * from a client. Previously the field was schema-optional and persisted directly, so a
 * tenant could mint roles indistinguishable from system seeds (Admin/Member) — that
 * would defeat the `is_system` guard added on the delete path in the same PR, since
 * a tenant could simply flip the flag on a fresh role.
 *
 * `is_system` is a server-only flag set by the seeds (`tenancy.bulk.seed.ts`); clients
 * have no legitimate path to set it.
 */
describe('createMemberRoleDto — sec-T3: is_system is server-only', () => {
  it('rejects bodies that include `is_system` (the strict() shape catches the unknown key)', () => {
    const result = createMemberRoleDto.safeParse({
      name: 'My Custom Role',
      is_system: true,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a clean body without `is_system`', () => {
    const result = createMemberRoleDto.safeParse({
      name: 'My Custom Role',
      description: 'For my team',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // The output shape must NOT include `is_system` at all — even as undefined — so
      // downstream code that destructures it cannot accidentally persist a value.
      expect('is_system' in result.data).toBe(false);
    }
  });
});
