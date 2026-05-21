import { describe, expect, it } from 'vitest';
import { serializeMemberRolePermission } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

describe('member-role-permission serializer', () => {
  it('serializeMemberRolePermission maps permission code', () => {
    expect(
      serializeMemberRolePermission(
        { permission_code: 'user:read', created_at: createdAt },
        'role-public',
      ),
    ).toEqual({
      role_id: 'role-public',
      permission_code: 'user:read',
      created_at: createdAt.toISOString(),
    });
  });
});
