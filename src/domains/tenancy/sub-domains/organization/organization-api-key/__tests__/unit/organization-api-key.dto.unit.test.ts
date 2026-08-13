import { describe, expect, it } from 'vitest';
import {
  apiKeyIdParamsDto,
  createOrganizationApiKeyDto,
  updateOrganizationApiKeyDto,
} from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.dto.js';

/**
 * An organization API key is a long-lived, non-interactive credential — the highest-value thing
 * a tenant can mint. These schemas decide what a caller may ask for when creating one, so they
 * are the privilege boundary: the scope list, the expiry window, and (via `.strict()`) whether a
 * client can smuggle fields the service never intended to accept, such as a pre-set token, an
 * organization id, or a status that would revive a revoked key.
 */
describe('organization-api-key.dto', () => {
  const validKey = { name: 'CI deploy key', scopes: ['read:organizations'] };

  describe('createOrganizationApiKeyDto', () => {
    it('accepts a name and a single scope', () => {
      expect(createOrganizationApiKeyDto.safeParse(validKey).success).toBe(true);
    });

    it('accepts an optional expiry in days', () => {
      expect(
        createOrganizationApiKeyDto.safeParse({ ...validKey, expires_in_days: 30 }).success,
      ).toBe(true);
    });

    it('accepts a null expiry (a non-expiring key is an explicit choice)', () => {
      expect(
        createOrganizationApiKeyDto.safeParse({ ...validKey, expires_in_days: null }).success,
      ).toBe(true);
    });

    describe('scopes', () => {
      it('requires at least one scope — a scopeless key is never created implicitly', () => {
        expect(createOrganizationApiKeyDto.safeParse({ ...validKey, scopes: [] }).success).toBe(
          false,
        );
      });

      it('rejects a missing scopes array', () => {
        expect(createOrganizationApiKeyDto.safeParse({ name: validKey.name }).success).toBe(false);
      });

      it('accepts exactly 50 scopes (max boundary)', () => {
        const scopes = Array.from({ length: 50 }, (_value, index) => `scope:${index}`);

        expect(createOrganizationApiKeyDto.safeParse({ ...validKey, scopes }).success).toBe(true);
      });

      it('rejects 51 scopes — the list is bounded so a key cannot be arbitrarily broad', () => {
        const scopes = Array.from({ length: 51 }, (_value, index) => `scope:${index}`);

        expect(createOrganizationApiKeyDto.safeParse({ ...validKey, scopes }).success).toBe(false);
      });

      it.each([
        ['an empty scope string', ['']],
        ['a whitespace-only scope', ['   ']],
        ['a scope over 100 characters', ['s'.repeat(101)]],
        ['a non-string scope', [42]],
        ['a nested array', [['read']]],
        ['a null scope', [null]],
      ])('rejects %s', (_label, scopes) => {
        expect(createOrganizationApiKeyDto.safeParse({ ...validKey, scopes }).success).toBe(false);
      });

      it('rejects scopes supplied as a string rather than an array', () => {
        expect(
          createOrganizationApiKeyDto.safeParse({ ...validKey, scopes: 'read:organizations' })
            .success,
        ).toBe(false);
      });
    });

    describe('expires_in_days', () => {
      it.each([
        ['1 day (min boundary)', 1],
        ['365 days (max boundary)', 365],
      ])('accepts %s', (_label, expires_in_days) => {
        expect(
          createOrganizationApiKeyDto.safeParse({ ...validKey, expires_in_days }).success,
        ).toBe(true);
      });

      it.each([
        ['zero', 0],
        ['a negative window', -1],
        ['366 days (over max)', 366],
        ['a fractional window', 1.5],
        ['a string', '30'],
        ['Infinity', Number.POSITIVE_INFINITY],
      ])('rejects %s', (_label, expires_in_days) => {
        expect(
          createOrganizationApiKeyDto.safeParse({ ...validKey, expires_in_days }).success,
        ).toBe(false);
      });
    });

    describe('name', () => {
      it.each([
        ['an empty name', ''],
        ['a whitespace-only name', '   '],
        ['a name over 255 characters', 'a'.repeat(256)],
      ])('rejects %s', (_label, name) => {
        expect(createOrganizationApiKeyDto.safeParse({ ...validKey, name }).success).toBe(false);
      });

      it('trims surrounding whitespace', () => {
        expect(createOrganizationApiKeyDto.parse({ ...validKey, name: '  CI  ' }).name).toBe('CI');
      });
    });

    describe('.strict() — the privilege boundary', () => {
      it.each([
        ['a pre-set token', { token: 'sk_attacker_supplied' }],
        ['a key hash', { key_hash: 'deadbeef' }],
        ['an organization id', { organization_id: 'org_other' }],
        ['a status', { status: 'ACTIVE' }],
        ['an id', { id: 1 }],
        ['a last_used_at', { last_used_at: '2026-01-01T00:00:00.000Z' }],
      ])('rejects %s', (_label, extra) => {
        expect(createOrganizationApiKeyDto.safeParse({ ...validKey, ...extra }).success).toBe(
          false,
        );
      });
    });
  });

  describe('updateOrganizationApiKeyDto', () => {
    it('accepts an empty object', () => {
      expect(updateOrganizationApiKeyDto.safeParse({}).success).toBe(true);
    });

    it.each(['ACTIVE', 'REVOKED'])('accepts the %s status', (status) => {
      expect(updateOrganizationApiKeyDto.safeParse({ status }).success).toBe(true);
    });

    it.each([
      ['a lowercase status', 'active'],
      ['an unknown status', 'EXPIRED'],
      ['an empty status', ''],
    ])('rejects %s', (_label, status) => {
      expect(updateOrganizationApiKeyDto.safeParse({ status }).success).toBe(false);
    });

    it('does NOT accept scopes on update — re-scoping a live key is not an update operation', () => {
      expect(updateOrganizationApiKeyDto.safeParse({ scopes: ['admin:everything'] }).success).toBe(
        false,
      );
    });

    it('does NOT accept an expiry extension on update', () => {
      expect(updateOrganizationApiKeyDto.safeParse({ expires_in_days: 365 }).success).toBe(false);
    });
  });

  describe('apiKeyIdParamsDto', () => {
    it('accepts a well-formed id', () => {
      expect(apiKeyIdParamsDto.safeParse({ api_key_id: 'key_abcdefghijklmnopqrst' }).success).toBe(
        true,
      );
    });

    it.each([
      ['an empty id', ''],
      ['an id over 28 characters', 'k'.repeat(29)],
    ])('rejects %s', (_label, api_key_id) => {
      expect(apiKeyIdParamsDto.safeParse({ api_key_id }).success).toBe(false);
    });

    it('rejects an unknown extra param', () => {
      expect(
        apiKeyIdParamsDto.safeParse({ api_key_id: 'key_abc', organization_id: 'org_other' })
          .success,
      ).toBe(false);
    });
  });
});
