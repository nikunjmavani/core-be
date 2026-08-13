import { describe, expect, it } from 'vitest';
import {
  apiKeyIdParamsDto,
  createOrganizationDto,
  notificationPolicyIdParamsDto,
  organizationSlugParamsDto,
  roleIdParamsDto,
  updateOrganizationDto,
} from '@/domains/tenancy/sub-domains/organization/organization.dto.js';

/**
 * These schemas are the mass-assignment boundary for the tenancy domain's most privileged
 * resource. Every one is `.strict()`, which is what stops a caller sending `{ name, status }` to
 * an endpoint that only accepts `name` — dropping `.strict()` from any of them is a one-word edit
 * with no visible symptom until someone self-promotes an organization out of SUSPENDED.
 */
describe('organization.dto', () => {
  describe('createOrganizationDto', () => {
    it('accepts a valid name and slug', () => {
      const parsed = createOrganizationDto.parse({ name: 'Acme Corporation', slug: 'acme-corp' });

      expect(parsed).toEqual({ name: 'Acme Corporation', slug: 'acme-corp' });
    });

    it('trims surrounding whitespace on both fields', () => {
      const parsed = createOrganizationDto.parse({ name: '  Acme  ', slug: '  acme  ' });

      expect(parsed).toEqual({ name: 'Acme', slug: 'acme' });
    });

    it.each([
      ['a missing name', { slug: 'acme' }],
      ['a missing slug', { name: 'Acme' }],
      ['an empty name', { name: '', slug: 'acme' }],
      ['a whitespace-only name', { name: '   ', slug: 'acme' }],
      ['a name over 255 characters', { name: 'a'.repeat(256), slug: 'acme' }],
      ['a slug over 100 characters', { name: 'Acme', slug: 'a'.repeat(101) }],
    ])('rejects %s', (_label, input) => {
      expect(createOrganizationDto.safeParse(input).success).toBe(false);
    });

    it.each([
      ['uppercase', 'Acme'],
      ['spaces', 'acme corp'],
      ['underscores', 'acme_corp'],
      ['a slash (path segment)', 'acme/admin'],
      ['a dot', 'acme.corp'],
      ['unicode', 'acmé'],
    ])('rejects a slug containing %s', (_label, slug) => {
      expect(createOrganizationDto.safeParse({ name: 'Acme', slug }).success).toBe(false);
    });

    it.each([
      ['lowercase letters', 'acme'],
      ['digits', 'acme2024'],
      ['hyphens', 'acme-corp-eu'],
    ])('accepts a slug of %s', (_label, slug) => {
      expect(createOrganizationDto.safeParse({ name: 'Acme', slug }).success).toBe(true);
    });

    it('rejects an unknown key — no status smuggling at creation', () => {
      const result = createOrganizationDto.safeParse({
        name: 'Acme',
        slug: 'acme',
        status: 'ACTIVE',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an id or owner supplied by the client', () => {
      expect(createOrganizationDto.safeParse({ name: 'Acme', slug: 'acme', id: 1 }).success).toBe(
        false,
      );
      expect(
        createOrganizationDto.safeParse({ name: 'Acme', slug: 'acme', owner_id: 9 }).success,
      ).toBe(false);
    });
  });

  describe('updateOrganizationDto', () => {
    it('accepts an empty object — every field is optional on update', () => {
      expect(updateOrganizationDto.safeParse({}).success).toBe(true);
    });

    it.each(['ACTIVE', 'SUSPENDED', 'ARCHIVED'])('accepts the %s status', (status) => {
      expect(updateOrganizationDto.safeParse({ status }).success).toBe(true);
    });

    it.each([
      ['a lowercase status', 'active'],
      ['an unknown status', 'DELETED'],
      ['an empty status', ''],
    ])('rejects %s', (_label, status) => {
      expect(updateOrganizationDto.safeParse({ status }).success).toBe(false);
    });

    it('accepts a partial update of name only', () => {
      expect(updateOrganizationDto.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    });

    it('rejects an unknown key', () => {
      expect(updateOrganizationDto.safeParse({ name: 'Acme', plan_id: 'pln_x' }).success).toBe(
        false,
      );
    });

    it('still enforces the slug pattern when a slug is supplied', () => {
      expect(updateOrganizationDto.safeParse({ slug: 'Not A Slug' }).success).toBe(false);
    });
  });

  describe('id param schemas', () => {
    const cases = [
      ['organizationSlugParamsDto', organizationSlugParamsDto, 'slug', 'acme-corp'],
      ['roleIdParamsDto', roleIdParamsDto, 'role_id', 'rol_abcdefghijklmnopqrstu'],
      ['apiKeyIdParamsDto', apiKeyIdParamsDto, 'api_key_id', 'key_abcdefghijklmnopqrstu'],
      [
        'notificationPolicyIdParamsDto',
        notificationPolicyIdParamsDto,
        'notification_policy_id',
        'nps_abcdefghijklmnopqrstu',
      ],
    ] as const;

    it.each(cases)('%s accepts a well-formed value', (_name, schema, field, value) => {
      expect(schema.safeParse({ [field]: value }).success).toBe(true);
    });

    it.each(cases)('%s rejects an empty value', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: '' }).success).toBe(false);
    });

    it.each(cases)('%s rejects a missing value', (_name, schema) => {
      expect(schema.safeParse({}).success).toBe(false);
    });

    it.each(cases)('%s rejects an unknown extra param', (_name, schema, field, value) => {
      expect(schema.safeParse({ [field]: value, injected: 'x' }).success).toBe(false);
    });

    it.each(cases)('%s rejects a non-string value', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: 42 }).success).toBe(false);
    });

    it.each([
      ['roleIdParamsDto', roleIdParamsDto, 'role_id'],
      ['apiKeyIdParamsDto', apiKeyIdParamsDto, 'api_key_id'],
      ['notificationPolicyIdParamsDto', notificationPolicyIdParamsDto, 'notification_policy_id'],
    ] as const)('%s caps the id at 28 characters', (_name, schema, field) => {
      expect(schema.safeParse({ [field]: 'a'.repeat(28) }).success).toBe(true);
      expect(schema.safeParse({ [field]: 'a'.repeat(29) }).success).toBe(false);
    });
  });
});
