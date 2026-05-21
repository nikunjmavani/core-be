import { describe, expect, it } from 'vitest';
import { generateFieldExample } from '../../../../../tooling/openapi/enrichers/field-examples.js';

describe('field-examples', () => {
  it('generateFieldExample returns email-shaped examples for email fields', () => {
    const example = generateFieldExample('email', { type: 'string', format: 'email' });
    expect(String(example)).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it('generateFieldExample prefers enum values', () => {
    expect(generateFieldExample('status', { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] })).toBe(
      'ACTIVE',
    );
  });

  it('generateFieldExample maps organization_id to a public id shape', () => {
    const example = generateFieldExample('organization_id', { type: 'string' });
    expect(String(example)).toMatch(/^org_/);
  });
});
