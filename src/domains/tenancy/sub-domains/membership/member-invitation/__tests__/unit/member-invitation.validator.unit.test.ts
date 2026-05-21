import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateAcceptMemberInvitation,
  validateCreateMemberInvitation,
  validateResendMemberInvitation,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.validator.js';

describe('member-invitation validators', () => {
  it('validateCreateMemberInvitation accepts membership and email', () => {
    const result = validateCreateMemberInvitation({
      membership_id: 'membershippublicid1',
      email: 'invite@example.com',
    });
    expect(result.email).toBe('invite@example.com');
    expect(result.expires_in_days).toBe(7);
  });

  it('validateAcceptMemberInvitation accepts token', () => {
    expect(validateAcceptMemberInvitation({ token: 'invite-token' })).toEqual({
      token: 'invite-token',
    });
  });

  it('validateResendMemberInvitation applies default expires_in_days', () => {
    expect(validateResendMemberInvitation({})).toEqual({ expires_in_days: 7 });
  });

  it('validateCreateMemberInvitation rejects invalid email', () => {
    expect(() =>
      validateCreateMemberInvitation({
        membership_id: 'membershippublicid1',
        email: 'not-an-email',
      }),
    ).toThrow(ValidationError);
  });
});
