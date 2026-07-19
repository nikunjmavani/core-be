import { describe, expect, it } from 'vitest';
import { serializeMemberRole } from '@/domains/tenancy/sub-domains/member-roles/member-role.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

const roleRow = {
  public_id: 'role-public',
  name: 'Admin',
  description: 'Full access',
  is_system: true,
  created_at: createdAt,
  updated_at: updatedAt,
};

describe('member-role serializer', () => {
  it('serializeMemberRole maps role row and echoes the supplied member_count', () => {
    expect(serializeMemberRole(roleRow, 3)).toEqual({
      id: 'role-public',
      name: 'Admin',
      description: 'Full access',
      is_system: true,
      member_count: 3,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });

  it('serializeMemberRole surfaces member_count 0 for a role with no members', () => {
    expect(serializeMemberRole(roleRow, 0)).toMatchObject({ member_count: 0 });
  });
});
