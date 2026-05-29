import { describe, expect, it } from 'vitest';
import {
  generateOperationId,
  inferTagFromPath,
} from '../../../../../tooling/openapi/emitters/operation-helpers.js';

describe('operation-helpers', () => {
  it('generateOperationId builds camelCase operation ids', () => {
    expect(generateOperationId('GET', '/api/v1/auth/me')).toMatch(/^getAuth/i);
    expect(generateOperationId('POST', '/api/v1/tenancy/organizations/{id}/invitations')).toMatch(
      /^postTenancy/i,
    );
  });

  it('inferTagFromPath title-cases the first API segment', () => {
    expect(inferTagFromPath('/api/v1/auth/login')).toBe('Auth');
    expect(inferTagFromPath('/readyz')).toBe('General');
  });
});
