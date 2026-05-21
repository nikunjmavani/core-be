import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateCreateOrganizationApiKey,
  validateListOrganizationApiKeysQuery,
  validateUpdateOrganizationApiKey,
} from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.validator.js';

describe('organization-api-key validators', () => {
  it('validateCreateOrganizationApiKey accepts name and scopes', () => {
    expect(validateCreateOrganizationApiKey({ name: 'CI key', scopes: ['api-key:read'] })).toEqual({
      name: 'CI key',
      scopes: ['api-key:read'],
    });
  });

  it('validateUpdateOrganizationApiKey accepts status', () => {
    expect(validateUpdateOrganizationApiKey({ status: 'REVOKED' })).toEqual({
      status: 'REVOKED',
    });
  });

  it('validateListOrganizationApiKeysQuery applies defaults', () => {
    expect(validateListOrganizationApiKeysQuery({})).toMatchObject({ limit: 25 });
  });

  it('validateCreateOrganizationApiKey throws for empty name', () => {
    expect(() => validateCreateOrganizationApiKey({ name: '', scopes: ['api-key:read'] })).toThrow(
      ValidationError,
    );
  });

  it('validateCreateOrganizationApiKey rejects expires_in_days out of range', () => {
    expect(() =>
      validateCreateOrganizationApiKey({
        name: 'Key',
        scopes: ['api-key:read'],
        expires_in_days: 400,
      }),
    ).toThrow(ValidationError);
  });
});
