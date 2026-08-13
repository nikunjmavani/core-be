import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  PROTO_POLLUTION_KEYS,
  updateOrganizationSettingsDto,
} from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.dto.js';
import { validateUpdateOrganizationSettings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.validator.js';

/**
 * `security_policy` is the only free-form JSONB record a tenant can write through the API, so it is
 * the one place a caller controls both the keys and the values that land in the database.
 *
 * The prototype-pollution guard here is genuinely two-layered, and the split is easy to undo by
 * accident. `constructor` and `prototype` arrive as ordinary own keys, so the Zod refine rejects
 * them. `__proto__` does NOT: Zod's record reconstruction drops it before any refine runs, so the
 * schema alone reports SUCCESS with the key silently gone. Only the validator's raw
 * `Reflect.ownKeys` scan — which runs BEFORE Zod — can turn that into a rejection (route-audit C4).
 *
 * This suite therefore asserts both layers separately, including the uncomfortable fact that the
 * schema on its own accepts a `__proto__` payload. Collapsing the validator into a plain
 * `parseWithSchema` call would keep every schema-level test green while reopening the hole.
 */
describe('organization-settings.dto', () => {
  describe('security_policy — prototype-pollution keys', () => {
    it.each([['constructor'], ['prototype']])('the schema rejects an own %s key', (key) => {
      expect(
        updateOrganizationSettingsDto.safeParse({ security_policy: { [key]: 'x' } }).success,
      ).toBe(false);
    });

    it('the schema alone does NOT reject __proto__ — it silently drops it', () => {
      // This is the exact reason the validator exists. Zod reports success and hands back an empty
      // record, so a caller probing for the key would get a 200 with no indication it was ignored.
      const result = updateOrganizationSettingsDto.safeParse(
        JSON.parse('{"security_policy":{"__proto__":"polluted"}}'),
      );

      expect(result.success).toBe(true);
      expect(result.success && result.data.security_policy).toEqual({});
    });

    it('the validator rejects __proto__ from the raw body', () => {
      expect(() =>
        validateUpdateOrganizationSettings(
          JSON.parse('{"security_policy":{"__proto__":"polluted"}}'),
        ),
      ).toThrow(ValidationError);
    });

    it.each([['constructor'], ['prototype']])('the validator rejects %s too', (key) => {
      expect(() => validateUpdateOrganizationSettings({ security_policy: { [key]: 'x' } })).toThrow(
        ValidationError,
      );
    });

    it('reports the rejection against the security_policy field', () => {
      try {
        validateUpdateOrganizationSettings(
          JSON.parse('{"security_policy":{"__proto__":"polluted"}}'),
        );
        expect.unreachable('expected a ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(JSON.stringify(error)).toContain('security_policy');
      }
    });

    it('does not pollute Object.prototype even on the rejected path', () => {
      const probe = {} as Record<string, unknown>;

      expect(() =>
        validateUpdateOrganizationSettings(
          JSON.parse('{"security_policy":{"__proto__":{"polluted":true}}}'),
        ),
      ).toThrow(ValidationError);
      expect(probe.polluted).toBeUndefined();
    });

    it('keeps the guarded key set in one place', () => {
      // The validator's raw scan and the schema refine must consult the same set; a key added to
      // one and not the other is exactly the drift this constant prevents.
      expect([...PROTO_POLLUTION_KEYS].sort()).toEqual(['__proto__', 'constructor', 'prototype']);
    });

    it('accepts an ordinary key that merely contains a guarded word', () => {
      expect(
        updateOrganizationSettingsDto.safeParse({ security_policy: { constructor_name: 'x' } })
          .success,
      ).toBe(true);
    });

    it('tolerates a non-object security_policy in the raw scan (Zod reports it)', () => {
      // The scan must not throw on a shape it was not built for — it defers to the schema.
      expect(() =>
        validateUpdateOrganizationSettings({ security_policy: 'not-an-object' }),
      ).toThrow(ValidationError);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string body', 'nonsense'],
      ['a number body', 7],
    ])('tolerates %s as the whole body without crashing the scan', (_label, body) => {
      // Reaching Zod is the requirement; whether it passes or fails is the schema's business.
      expect(() => validateUpdateOrganizationSettings(body)).toThrow(ValidationError);
    });
  });

  describe('security_policy — bounds', () => {
    it('accepts an empty record', () => {
      expect(updateOrganizationSettingsDto.safeParse({ security_policy: {} }).success).toBe(true);
    });

    it('accepts 50 keys', () => {
      const security_policy = Object.fromEntries(
        Array.from({ length: 50 }, (_value, index) => [`key_${index}`, true]),
      );

      expect(updateOrganizationSettingsDto.safeParse({ security_policy }).success).toBe(true);
    });

    it('rejects 51 keys', () => {
      const security_policy = Object.fromEntries(
        Array.from({ length: 51 }, (_value, index) => [`key_${index}`, true]),
      );

      expect(updateOrganizationSettingsDto.safeParse({ security_policy }).success).toBe(false);
    });

    it('rejects a key over 100 characters', () => {
      expect(
        updateOrganizationSettingsDto.safeParse({ security_policy: { ['k'.repeat(101)]: true } })
          .success,
      ).toBe(false);
    });

    it('rejects an empty-string key', () => {
      expect(
        updateOrganizationSettingsDto.safeParse({ security_policy: { '': true } }).success,
      ).toBe(false);
    });

    it.each([
      ['a string', 'value'],
      ['a number', 42],
      ['a boolean', true],
      ['null', null],
      ['a string at 500 characters', 'v'.repeat(500)],
    ])('accepts %s as a value', (_label, value) => {
      expect(
        updateOrganizationSettingsDto.safeParse({ security_policy: { k: value } }).success,
      ).toBe(true);
    });

    it.each([
      ['a nested object', { nested: true }],
      ['an array', [1, 2, 3]],
      ['a string over 500 characters', 'v'.repeat(501)],
    ])('rejects %s as a value (scalars only — no unbounded nesting)', (_label, value) => {
      expect(
        updateOrganizationSettingsDto.safeParse({ security_policy: { k: value } }).success,
      ).toBe(false);
    });
  });

  describe('scalar settings', () => {
    it('accepts an empty body (PATCH semantics — every field optional)', () => {
      expect(updateOrganizationSettingsDto.safeParse({}).success).toBe(true);
    });

    it.each([['en'], ['es']])('accepts default_locale %s', (default_locale) => {
      expect(updateOrganizationSettingsDto.safeParse({ default_locale }).success).toBe(true);
    });

    it.each([['fr'], ['EN'], ['en-US'], ['']])(
      'rejects default_locale %s (only translated locales)',
      (default_locale) => {
        // The enum is the API's promise that a stored locale has translations behind it.
        expect(updateOrganizationSettingsDto.safeParse({ default_locale }).success).toBe(false);
      },
    );

    it('accepts a boolean is_email_notifications_enabled', () => {
      expect(
        updateOrganizationSettingsDto.safeParse({ is_email_notifications_enabled: false }).success,
      ).toBe(true);
    });

    it.each([
      ['the string "true"', 'true'],
      ['the number 1', 1],
      ['null', null],
    ])('rejects is_email_notifications_enabled as %s', (_label, value) => {
      expect(
        updateOrganizationSettingsDto.safeParse({ is_email_notifications_enabled: value }).success,
      ).toBe(false);
    });

    it.each([
      ['an organization id', { organization_id: 'org_other' }],
      ['a plan', { plan_id: 'pln_enterprise' }],
      ['a status', { status: 'ACTIVE' }],
      ['a member limit', { max_members: 9999 }],
    ])('rejects %s riding along (.strict)', (_label, extra) => {
      expect(updateOrganizationSettingsDto.safeParse(extra).success).toBe(false);
    });
  });
});
