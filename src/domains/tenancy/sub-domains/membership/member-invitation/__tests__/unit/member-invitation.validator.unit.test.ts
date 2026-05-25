import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateAcceptMemberInvitation,
  validateCreateMemberInvitation,
  validateListMemberInvitationsQuery,
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

  describe('validateListMemberInvitationsQuery (cursor pagination)', () => {
    it('returns defaults when called with empty query', () => {
      const parsed = validateListMemberInvitationsQuery({});
      expect(parsed.include_total).toBe('false');
      expect(parsed.after).toBeUndefined();
      expect(parsed.page).toBeUndefined();
      expect(typeof parsed.limit).toBe('number');
    });

    it('accepts after cursor with limit', () => {
      const parsed = validateListMemberInvitationsQuery({
        after: 'opaque-cursor-token',
        limit: '15',
      });
      expect(parsed.after).toBe('opaque-cursor-token');
      expect(parsed.limit).toBe(15);
    });

    it('accepts legacy page during deprecation window', () => {
      const parsed = validateListMemberInvitationsQuery({
        page: '3',
        limit: '10',
        include_total: 'true',
      });
      expect(parsed.page).toBe(3);
      expect(parsed.limit).toBe(10);
      expect(parsed.include_total).toBe('true');
    });

    it('rejects unknown query keys (strict)', () => {
      expect(() => validateListMemberInvitationsQuery({ unknown: '1' })).toThrow(ValidationError);
    });

    it('rejects non-boolean include_total values', () => {
      expect(() => validateListMemberInvitationsQuery({ include_total: 'yes' })).toThrow(
        ValidationError,
      );
    });

    it('rejects limit outside allowed range', () => {
      expect(() => validateListMemberInvitationsQuery({ limit: '0' })).toThrow(ValidationError);
      expect(() => validateListMemberInvitationsQuery({ limit: '1000' })).toThrow(ValidationError);
    });

    it('rejects negative page', () => {
      expect(() => validateListMemberInvitationsQuery({ page: '0' })).toThrow(ValidationError);
    });
  });
});
