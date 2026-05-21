import { describe, expect, it } from 'vitest';
import { serializeMembership } from '@/domains/tenancy/sub-domains/membership/membership.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

describe('membership serializer', () => {
  it('serializeMembership maps null joined_at', () => {
    expect(
      serializeMembership(
        {
          public_id: 'mem-public',
          user_id: 1,
          organization_id: 2,
          role_id: 3,
          status: 'INVITED',
          joined_at: null,
          created_at: createdAt,
          updated_at: updatedAt,
        },
        'org-public',
      ),
    ).toMatchObject({
      status: 'INVITED',
      joined_at: null,
    });
  });

  it('serializeMembership maps row with organization public id', () => {
    const joinedAt = new Date('2026-01-03T00:00:00.000Z');
    expect(
      serializeMembership(
        {
          public_id: 'mem-public',
          user_id: 1,
          organization_id: 2,
          role_id: 3,
          status: 'ACTIVE',
          joined_at: joinedAt,
          created_at: createdAt,
          updated_at: updatedAt,
        },
        'org-public',
      ),
    ).toEqual({
      id: 'mem-public',
      user_id: '1',
      organization_id: 'org-public',
      role_id: '3',
      status: 'ACTIVE',
      joined_at: joinedAt.toISOString(),
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
  });
});
