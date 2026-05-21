import { describe, expect, it } from 'vitest';
import { UserSerializer } from '@/domains/user/user.serializer.js';

const sampleRow = {
  public_id: 'user-public-id',
  email: 'user@example.com',
  is_email_verified: true,
  is_mfa_enabled: false,
  first_name: 'Jane',
  last_name: 'Doe',
  avatar_url: null,
  status: 'ACTIVE',
  created_at: new Date('2026-01-15T10:00:00.000Z'),
  updated_at: new Date('2026-01-16T10:00:00.000Z'),
};

describe('UserSerializer', () => {
  it('maps database row to API output with ISO dates', () => {
    expect(UserSerializer.one(sampleRow)).toEqual({
      id: 'user-public-id',
      email: 'user@example.com',
      is_email_verified: true,
      is_mfa_enabled: false,
      first_name: 'Jane',
      last_name: 'Doe',
      avatar_url: null,
      status: 'ACTIVE',
      created_at: '2026-01-15T10:00:00.000Z',
      updated_at: '2026-01-16T10:00:00.000Z',
    });
  });
});
