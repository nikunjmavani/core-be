import { describe, expect, it } from 'vitest';
import { serializeMembership } from '@/domains/tenancy/sub-domains/membership/membership.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');
const user = {
  id: 'user-public',
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  avatar_url: 'https://signed.example.com/avatar.png',
};
const role = { id: 'role-public', name: 'Admin' };

describe('membership serializer', () => {
  it('serializeMembership maps null joined_at and a null invitation (active row)', () => {
    expect(
      serializeMembership(
        {
          public_id: 'mem-public',
          status: 'ACTIVE',
          joined_at: null,
          created_at: createdAt,
          updated_at: updatedAt,
        },
        'org-public',
        user,
        role,
        null,
      ),
    ).toMatchObject({ status: 'ACTIVE', joined_at: null, invitation: null });
  });

  it('emits public ids + embedded user/role and never the internal sequential ids', () => {
    const joinedAt = new Date('2026-01-03T00:00:00.000Z');
    const serialized = serializeMembership(
      {
        public_id: 'mem-public',
        status: 'ACTIVE',
        joined_at: joinedAt,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      'org-public',
      user,
      role,
      null,
    );

    expect(serialized).toEqual({
      id: 'mem-public',
      user_id: 'user-public',
      organization_id: 'org-public',
      role_id: 'role-public',
      status: 'ACTIVE',
      joined_at: joinedAt.toISOString(),
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
      user,
      role,
      invitation: null,
    });
    // The flat ids mirror the embedded public ids; the internal bigserial ids must never appear.
    expect(serialized.user_id).toBe('user-public');
    expect(serialized.role_id).toBe('role-public');
  });

  it('embeds the live invitation ref on an INVITED row (id + ISO expires_at)', () => {
    const expiresAt = new Date('2026-02-01T00:00:00.000Z');
    const serialized = serializeMembership(
      {
        public_id: 'mem-public',
        status: 'INVITED',
        joined_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
      'org-public',
      user,
      role,
      { public_id: 'inv-public', expires_at: expiresAt },
    );
    expect(serialized.invitation).toEqual({
      id: 'inv-public',
      expires_at: expiresAt.toISOString(),
    });
    expect(serialized.user.email).toBe('jane@example.com');
    expect(serialized.role.name).toBe('Admin');
  });
});
