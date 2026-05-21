import { describe, expect, it } from 'vitest';
import { serializeMemberRole } from '@/domains/tenancy/sub-domains/member-roles/member-role.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

describe('member-role serializer', () => {
  it('serializeMemberRole maps role row', () => {
    expect(
      serializeMemberRole({
        public_id: 'role-public',
        name: 'Admin',
        description: 'Full access',
        is_system: true,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ).toEqual({
      id: 'role-public',
      name: 'Admin',
      description: 'Full access',
      is_system: true,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });
});
