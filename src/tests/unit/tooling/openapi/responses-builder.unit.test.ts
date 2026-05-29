import { describe, expect, it } from 'vitest';
import { buildResponses } from '../../../../../tooling/openapi/emitters/responses-builder.js';

describe('responses-builder', () => {
  it('buildResponses includes standard error responses', () => {
    const responses = buildResponses('GET', 'GET /readyz', {});

    expect(responses['400']).toBeDefined();
    expect(responses['401']).toBeDefined();
    expect(responses['404']).toBeDefined();
    expect(responses['500']).toBeDefined();
    expect(responses['409']).toBeUndefined();
  });

  it('buildResponses adds 409 for write methods', () => {
    const responses = buildResponses('POST', 'POST /api/v1/auth/login', {});
    expect(responses['409']).toBeDefined();
  });

  it('buildResponses uses route response map when defined', () => {
    const responses = buildResponses('GET', 'GET /readyz', { success: 'OK' });
    expect(responses['200']).toMatchObject({ description: 'OK' });
  });
});
