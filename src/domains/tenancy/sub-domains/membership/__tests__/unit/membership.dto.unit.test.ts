import { describe, expect, it } from 'vitest';
import {
  createMembershipDto,
  membershipIdParamsDto,
  transferOwnershipDto,
  updateMembershipDto,
} from '@/domains/tenancy/sub-domains/membership/membership.dto.js';

/**
 * Membership is how a person gains access to an organization's data, so these schemas sit
 * directly on the tenancy privilege boundary. Three behaviours here are easy to break silently
 * and were untested: the default invitation window, the `.refine()` that stops an empty update
 * from being treated as a valid no-op, and `.strict()` on every schema — including
 * `transferOwnershipDto`, where an extra key would ride along with a transfer of the most
 * privileged role in the organization.
 */
describe('membership.dto', () => {
  const validMembership = { email: 'person@example.com', role_id: 'rol_abcdefghijklmnopqrst' };

  describe('createMembershipDto', () => {
    it('accepts an email and role', () => {
      expect(createMembershipDto.safeParse(validMembership).success).toBe(true);
    });

    it('defaults expires_in_days to 7 when omitted', () => {
      // The default is the invitation lifetime; losing it would mint non-expiring invitations.
      expect(createMembershipDto.parse(validMembership).expires_in_days).toBe(7);
    });

    it('accepts an explicit expiry within bounds', () => {
      expect(
        createMembershipDto.parse({ ...validMembership, expires_in_days: 30 }).expires_in_days,
      ).toBe(30);
    });

    it.each([
      ['1 day (min boundary)', 1],
      ['365 days (max boundary)', 365],
    ])('accepts %s', (_label, expires_in_days) => {
      expect(createMembershipDto.safeParse({ ...validMembership, expires_in_days }).success).toBe(
        true,
      );
    });

    it.each([
      ['zero', 0],
      ['a negative window', -1],
      ['366 days (over max)', 366],
      ['a fractional window', 7.5],
      ['a string', '7'],
    ])('rejects %s', (_label, expires_in_days) => {
      expect(createMembershipDto.safeParse({ ...validMembership, expires_in_days }).success).toBe(
        false,
      );
    });

    describe('email', () => {
      it('lowercases and trims for canonical storage', () => {
        expect(
          createMembershipDto.parse({ ...validMembership, email: '  Person@Example.COM  ' }).email,
        ).toBe('person@example.com');
      });

      it.each([
        ['a missing local part', '@example.com'],
        ['a missing domain', 'person@'],
        ['no @ at all', 'person.example.com'],
        ['an empty email', ''],
        ['a non-string email', 42],
      ])('rejects %s', (_label, email) => {
        expect(createMembershipDto.safeParse({ ...validMembership, email }).success).toBe(false);
      });

      it('rejects gmail plus-addressing (the documented anti-abuse rule)', () => {
        // trimmedEmail() forbids "+" in the local part for gmail/googlemail so one inbox cannot
        // mint unlimited distinct invitations.
        expect(
          createMembershipDto.safeParse({ ...validMembership, email: 'person+alias@gmail.com' })
            .success,
        ).toBe(false);
      });
    });

    it('requires a role_id — a member is never created without a role', () => {
      expect(createMembershipDto.safeParse({ email: validMembership.email }).success).toBe(false);
    });

    it.each([
      ['a status', { status: 'ACTIVE' }],
      ['an organization id', { organization_id: 'org_other' }],
      ['a user id', { user_id: 'usr_other' }],
      ['an is_owner flag', { is_owner: true }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      expect(createMembershipDto.safeParse({ ...validMembership, ...extra }).success).toBe(false);
    });
  });

  describe('updateMembershipDto', () => {
    it.each(['INVITED', 'ACTIVE', 'SUSPENDED'])('accepts the %s status', (status) => {
      expect(updateMembershipDto.safeParse({ status }).success).toBe(true);
    });

    it('accepts a role change alone', () => {
      expect(updateMembershipDto.safeParse({ role_id: 'rol_abc' }).success).toBe(true);
    });

    it('accepts both fields together', () => {
      expect(updateMembershipDto.safeParse({ status: 'ACTIVE', role_id: 'rol_abc' }).success).toBe(
        true,
      );
    });

    it('REJECTS an empty object — an update must actually say what it changes', () => {
      // The .refine() guard: without it an empty PATCH would be accepted as a successful no-op,
      // and the caller would believe a change landed.
      expect(updateMembershipDto.safeParse({}).success).toBe(false);
    });

    it.each([
      ['a lowercase status', 'active'],
      ['an unknown status', 'REMOVED'],
      ['an empty status', ''],
    ])('rejects %s', (_label, status) => {
      expect(updateMembershipDto.safeParse({ status }).success).toBe(false);
    });

    it('rejects an unknown key', () => {
      expect(updateMembershipDto.safeParse({ status: 'ACTIVE', is_owner: true }).success).toBe(
        false,
      );
    });
  });

  describe('transferOwnershipDto', () => {
    it('accepts a new owner id', () => {
      expect(
        transferOwnershipDto.safeParse({ new_owner_user_id: 'usr_abcdefghijklmnopqrst' }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty id', ''],
      ['an id over 28 characters', 'u'.repeat(29)],
      ['a missing id', undefined],
      ['a numeric id', 42],
    ])('rejects %s', (_label, new_owner_user_id) => {
      const payload = new_owner_user_id === undefined ? {} : { new_owner_user_id };
      expect(transferOwnershipDto.safeParse(payload).success).toBe(false);
    });

    it('rejects any extra key on the most privileged operation in the domain', () => {
      expect(
        transferOwnershipDto.safeParse({
          new_owner_user_id: 'usr_abc',
          keep_previous_owner_as_admin: true,
        }).success,
      ).toBe(false);
    });
  });

  describe('membershipIdParamsDto', () => {
    it('accepts a well-formed id', () => {
      expect(
        membershipIdParamsDto.safeParse({ membership_id: 'mem_abcdefghijklmnopqrst' }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty id', ''],
      ['an id over 28 characters', 'm'.repeat(29)],
    ])('rejects %s', (_label, membership_id) => {
      expect(membershipIdParamsDto.safeParse({ membership_id }).success).toBe(false);
    });

    it('rejects an unknown extra param', () => {
      expect(
        membershipIdParamsDto.safeParse({ membership_id: 'mem_abc', organization_id: 'org_other' })
          .success,
      ).toBe(false);
    });
  });
});
