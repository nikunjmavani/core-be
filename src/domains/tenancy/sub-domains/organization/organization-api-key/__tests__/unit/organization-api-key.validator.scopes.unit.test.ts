import { describe, expect, it } from 'vitest';
import { validateCreateOrganizationApiKey } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.validator.js';
import { ValidationError } from '@/shared/errors/index.js';

const baseValidPayload = {
  name: 'Service API key',
  scopes: ['read:users'],
};

describe('organization-api-key.validator scope edges', () => {
  it('rejects empty scopes array (min 1 required)', () => {
    expect(() => validateCreateOrganizationApiKey({ ...baseValidPayload, scopes: [] })).toThrow(
      ValidationError,
    );
  });

  it('rejects a scope string longer than 100 chars', () => {
    const overlongScope = 'a'.repeat(101);
    expect(() =>
      validateCreateOrganizationApiKey({ ...baseValidPayload, scopes: [overlongScope] }),
    ).toThrow(ValidationError);
  });

  it('rejects name longer than configured max (255 chars)', () => {
    const overlongName = 'n'.repeat(256);
    expect(() =>
      validateCreateOrganizationApiKey({ ...baseValidPayload, name: overlongName }),
    ).toThrow(ValidationError);
  });

  it('rejects unknown root keys (strict)', () => {
    expect(() =>
      validateCreateOrganizationApiKey({ ...baseValidPayload, unknown: 'oops' }),
    ).toThrow(ValidationError);
  });
});
