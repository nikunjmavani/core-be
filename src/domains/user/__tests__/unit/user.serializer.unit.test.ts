import { describe, expect, it } from 'vitest';
import { UserSerializer } from '@/domains/user/user.serializer.js';

const sampleRow = {
  public_id: 'user-public-id',
  email: 'user@example.com',
  is_email_verified: true,
  is_mfa_enabled: false,
  first_name: 'Jane',
  last_name: 'Doe',
  job_title: 'Engineer',
  avatar_url: null,
  status: 'ACTIVE',
  onboarding_completed_at: new Date('2026-01-15T10:05:00.000Z'),
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
      job_title: 'Engineer',
      avatar_url: null,
      status: 'ACTIVE',
      onboarding_completed: true,
      created_at: '2026-01-15T10:00:00.000Z',
      updated_at: '2026-01-16T10:00:00.000Z',
    });
  });

  it('projects a null onboarding timestamp to onboarding_completed=false', () => {
    expect(UserSerializer.one({ ...sampleRow, onboarding_completed_at: null })).toMatchObject({
      onboarding_completed: false,
    });
  });
});
