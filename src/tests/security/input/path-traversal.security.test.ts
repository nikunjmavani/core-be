import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import type { FastifyInstance } from 'fastify';

const TRAVERSAL_PAYLOADS = [
  '../../../etc/passwd',
  '..%2F..%2F..%2Fetc%2Fpasswd',
  '....//....//etc/passwd',
  '%2e%2e%2f%2e%2e%2f',
];

describe('Security: Path traversal', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
    const user = await createTestUser();
    token = await generateTestToken({ userId: user.public_id });
  });

  afterAll(async () => {
    await app.close();
  });

  for (const payload of TRAVERSAL_PAYLOADS) {
    it(`should not expose files for traversal payload in organization path (${payload})`, async () => {
      const encoded = encodeURIComponent(payload);
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${encoded}`),
        token,
      });

      expect([400, 401, 403, 404]).toContain(response.statusCode);
      expect(response.statusCode).toBeLessThan(500);
    });
  }
});
