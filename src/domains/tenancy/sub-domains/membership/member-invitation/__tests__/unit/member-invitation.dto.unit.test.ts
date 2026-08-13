import { describe, expect, it } from 'vitest';
import {
  acceptMemberInvitationDto,
  invitationIdParamsDto,
  resendMemberInvitationDto,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.dto.js';

/**
 * The invitation accept/resend schemas. Two properties are worth pinning.
 *
 * The accept body carries the RAW invitation token, which is SHA-256 compared against the stored
 * `token_hash`. Because the comparison is a hash lookup, the schema is the only place an
 * absurdly-long or empty token is turned away before it reaches hashing — and the accept route is
 * reachable by an unauthenticated invitee, so it is the least-privileged input in the domain.
 *
 * The resend body's `expires_in_days` extends an invitation's validity window. It is capped at 365
 * so a caller cannot mint an effectively permanent invitation link, and floored at 1 so a
 * non-positive value cannot produce an already-expired (or backdated) window.
 */
describe('member-invitation.dto', () => {
  describe('acceptMemberInvitationDto', () => {
    it('accepts a well-formed token', () => {
      expect(acceptMemberInvitationDto.safeParse({ token: 'a'.repeat(64) }).success).toBe(true);
    });

    it('accepts a token at 512 characters', () => {
      expect(acceptMemberInvitationDto.safeParse({ token: 'a'.repeat(512) }).success).toBe(true);
    });

    it('rejects a token over 512 characters', () => {
      expect(acceptMemberInvitationDto.safeParse({ token: 'a'.repeat(513) }).success).toBe(false);
    });

    it.each([
      ['an empty token', ''],
      ['a whitespace-only token', '     '],
    ])('rejects %s', (_label, token) => {
      // Whitespace trims to empty; an empty token must never reach the hash comparison.
      expect(acceptMemberInvitationDto.safeParse({ token }).success).toBe(false);
    });

    it('rejects a missing token', () => {
      expect(acceptMemberInvitationDto.safeParse({}).success).toBe(false);
    });

    it.each([
      ['a number', 42],
      ['null', null],
      ['an array', ['a'.repeat(64)]],
      ['an object', { hash: 'a'.repeat(64) }],
    ])('rejects %s as a token', (_label, token) => {
      expect(acceptMemberInvitationDto.safeParse({ token }).success).toBe(false);
    });

    it('trims the token before length checks', () => {
      expect(acceptMemberInvitationDto.parse({ token: '  abc  ' }).token).toBe('abc');
    });

    it.each([
      ['a role', { role: 'owner' }],
      ['an organization id', { organization_id: 'org_other' }],
      ['an email', { email: 'attacker@example.com' }],
      ['a member role id', { member_role_id: 'rol_admin' }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      // The invitation row decides the role and the organization; accepting it must not let the
      // invitee choose either.
      expect(acceptMemberInvitationDto.safeParse({ token: 'a'.repeat(64), ...extra }).success).toBe(
        false,
      );
    });
  });

  describe('resendMemberInvitationDto', () => {
    it('defaults expires_in_days to 7', () => {
      expect(resendMemberInvitationDto.parse({}).expires_in_days).toBe(7);
    });

    it.each([[1], [7], [30], [365]])('accepts %i days', (expires_in_days) => {
      expect(resendMemberInvitationDto.safeParse({ expires_in_days }).success).toBe(true);
    });

    it.each([
      ['zero', 0],
      ['a negative value', -1],
      ['a value over the cap', 366],
      ['a very large value', 100_000],
    ])('rejects %s', (_label, expires_in_days) => {
      expect(resendMemberInvitationDto.safeParse({ expires_in_days }).success).toBe(false);
    });

    it.each([
      ['a fractional value', 1.5],
      ['a numeric string', '7'],
      ['null', null],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects %s', (_label, expires_in_days) => {
      expect(resendMemberInvitationDto.safeParse({ expires_in_days }).success).toBe(false);
    });

    it('rejects an unknown key (.strict)', () => {
      expect(resendMemberInvitationDto.safeParse({ email: 'other@example.com' }).success).toBe(
        false,
      );
    });
  });

  describe('invitationIdParamsDto', () => {
    it('accepts a well-formed id', () => {
      expect(
        invitationIdParamsDto.safeParse({ invitation_id: 'inv_abcdefghijklmnopqrst' }).success,
      ).toBe(true);
    });

    it.each([
      ['an empty id', { invitation_id: '' }],
      ['an id over 28 characters', { invitation_id: 'i'.repeat(29) }],
      ['a missing id', {}],
      ['a numeric id', { invitation_id: 42 }],
      ['an extra param', { invitation_id: 'inv_abc', organization_id: 'org_other' }],
    ])('rejects %s', (_label, input) => {
      expect(invitationIdParamsDto.safeParse(input).success).toBe(false);
    });

    it('trims the id', () => {
      expect(invitationIdParamsDto.parse({ invitation_id: '  inv_abc  ' }).invitation_id).toBe(
        'inv_abc',
      );
    });
  });
});
