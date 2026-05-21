import { describe, expect, it } from 'vitest';
import { enrichSchema } from '../../../../../tooling/openapi/enrichers/schema-enricher.js';

describe('schema-enricher', () => {
  it('enrichSchema adds descriptions and examples to object properties', () => {
    const enriched = enrichSchema({
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
      },
    });

    const emailProperty = (enriched.properties as Record<string, Record<string, unknown>>).email;
    expect(emailProperty?.description).toContain('Required');
    expect(emailProperty?.example).toMatch(/@/);
    expect(enriched.example).toEqual({ email: emailProperty?.example });
  });
});
