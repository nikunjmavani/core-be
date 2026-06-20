import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateAcceptMemberInvitation,
  validateResendMemberInvitation,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.validator.js';

describe('member-invitation validators', () => {
  it('validateAcceptMemberInvitation accepts a token', () => {
    expect(validateAcceptMemberInvitation({ token: 'invite-token' })).toEqual({
      token: 'invite-token',
    });
  });

  it('validateAcceptMemberInvitation rejects an empty token (strict)', () => {
    expect(() => validateAcceptMemberInvitation({ token: '' })).toThrow(ValidationError);
  });

  it('validateResendMemberInvitation applies default expires_in_days', () => {
    expect(validateResendMemberInvitation({})).toEqual({ expires_in_days: 7 });
  });

  it('validateResendMemberInvitation rejects expires_in_days outside 1..365', () => {
    expect(() => validateResendMemberInvitation({ expires_in_days: 0 })).toThrow(ValidationError);
    expect(() => validateResendMemberInvitation({ expires_in_days: 366 })).toThrow(ValidationError);
  });

  it('validateResendMemberInvitation rejects unknown keys (strict)', () => {
    expect(() => validateResendMemberInvitation({ foo: 'bar' })).toThrow(ValidationError);
  });
});
