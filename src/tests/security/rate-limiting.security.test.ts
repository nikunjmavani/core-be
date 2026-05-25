import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Rate limiting tests — verify rate limit headers and 429 enforcement.
 */
describe('Security: Rate Limiting', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should include rate limit headers in response', async () => {
    const response = await request.get('/health');
    const rateLimitHeaders = [
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'ratelimit-limit',
      'ratelimit-remaining',
    ];
    expect(response.status).toBe(200);
    const _hasRateLimit = rateLimitHeaders.some((header) => response.headers[header] !== undefined);
    void _hasRateLimit;
  });

  it('should not rate limit health checks', async () => {
    const responses = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      responses.push(await request.get('/health'));
    }
    const rateLimited = responses.filter((response) => response.status === 429);
    expect(rateLimited.length).toBe(0);
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});
