import { describe, expect, it } from 'vitest';
import { buildResponses } from '@tooling/openapi/emitters/responses-builder.js';

function statuses(method: string, routeKey: string): string[] {
  return Object.keys(buildResponses(method, routeKey, {})).sort();
}

describe('responses-builder', () => {
  it('buildResponses includes standard error responses', () => {
    const responses = buildResponses('GET', 'GET /readyz', {});

    expect(responses['400']).toBeUndefined(); // /readyz has no body/params/query
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

  /**
   * Documented error-status matrix per HTTP method — keeps the generated spec
   * honest about the platform-wide contracts: rate limiting (429 everywhere),
   * idempotency 409/422 on mutating methods, Fastify body rejections (413/415)
   * on JSON-carrying methods, and MCP's Accept requirement (406).
   */
  describe('error-status matrix', () => {
    it('documents 429 on every operation', () => {
      expect(statuses('GET', 'GET /api/v1/users/me')).toContain('429');
      expect(statuses('DELETE', 'DELETE /api/v1/uploads/{publicId}')).toContain('429');
    });

    it('documents 409 and 422 on all mutating methods including DELETE', () => {
      for (const [method, key] of [
        ['POST', 'POST /api/v1/tenancy/organizations'],
        ['PATCH', 'PATCH /api/v1/users/me'],
        ['PUT', 'PUT /api/v1/users/me/avatar'],
        ['DELETE', 'DELETE /api/v1/uploads/{publicId}'],
      ] as const) {
        const documented = statuses(method, key);
        expect(documented, `${key} should document 409`).toContain('409');
        expect(documented, `${key} should document 422`).toContain('422');
      }
    });

    it('documents 413/415 on body-carrying methods only', () => {
      const post = statuses('POST', 'POST /api/v1/tenancy/organizations');
      expect(post).toContain('413');
      expect(post).toContain('415');
      const get = statuses('GET', 'GET /api/v1/users/me');
      expect(get).not.toContain('413');
      expect(get).not.toContain('415');
    });

    it('documents 406 only for MCP operations', () => {
      expect(statuses('POST', 'POST /api/v1/mcp')).toContain('406');
      expect(statuses('POST', 'POST /api/v1/tenancy/organizations')).not.toContain('406');
    });

    it('keeps GET error sets free of mutating-only statuses', () => {
      const get = statuses('GET', 'GET /api/v1/users/me');
      expect(get).not.toContain('409');
      expect(get).not.toContain('422');
    });
  });
});
