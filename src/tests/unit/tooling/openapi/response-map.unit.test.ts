import { describe, expect, it } from 'vitest';
import { routeResponseMap } from '../../../../../tooling/openapi/response-map/index.js';
import { wrapSuccess } from '../../../../../tooling/openapi/response-map/building-blocks.js';

describe('response-map', () => {
  it('routeResponseMap includes health and auth login responses', () => {
    expect(routeResponseMap['GET /health/live']?.statusCode).toBe(200);
    expect(routeResponseMap['POST /api/v1/auth/login']?.statusCode).toBe(200);
  });

  it('wrapSuccess nests data under meta envelope', () => {
    const wrapped = wrapSuccess({ type: 'object' }, { id: '1' }) as {
      example: { data: unknown; meta: { request_id: string } };
    };
    expect(wrapped.example.meta.request_id).toBe('req_a1b2c3d4e5f6');
    expect(wrapped.example.data).toEqual({ id: '1' });
  });
});
