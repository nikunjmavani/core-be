import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

/**
 * Resource-exhaustion / denial-of-service input hardening.
 *
 * Verifies the server fails *fast and cleanly* (4xx, never 5xx, never a hang)
 * on hostile inputs: oversized bodies (> the 1 MB `bodyLimit`), deeply nested
 * JSON, pagination-limit abuse beyond `PAGINATION.MAX_LIMIT` (100), and a
 * ReDoS-shaped slug that would hang a catastrophically-backtracking regex.
 */
describe('Security: payload / resource-exhaustion (DoS) hardening', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  // ─── Oversized body ─────────────────────────────────────────────────────────

  describe('oversized request body', () => {
    it('rejects a body larger than the 1 MB limit with 413 (not 5xx)', async () => {
      // ~1.5 MB string payload — well over the 1_048_576-byte bodyLimit.
      const huge = 'a'.repeat(1_500_000);
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/login'),
        payload: { email: 'attacker@example.com', password: huge },
      });
      expect(response.statusCode).toBe(413);
    });
  });

  // ─── Unsupported media type ─────────────────────────────────────────────────

  describe('unsupported content type', () => {
    it('rejects a non-JSON content type with a 4xx (not 5xx)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/login'),
        headers: { 'content-type': 'application/xml' },
        payload: '<credentials><email>a@b.com</email></credentials>',
      });
      // Fastify has no XML parser → framework 415; the handler must honor the
      // 4xx (regression guard for the body-too-large/415 → 500 masking bug).
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  // ─── Deeply nested JSON ─────────────────────────────────────────────────────

  describe('deeply nested JSON', () => {
    it('rejects deeply nested JSON cleanly (4xx, never 5xx / stack overflow)', async () => {
      // 5_000 levels of nesting, comfortably under the byte limit so the parser —
      // not the bodyLimit — is what must cope.
      const depth = 5_000;
      const nested = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
      const response = await app.inject({
        method: 'POST',
        url: testApiPath('/auth/login'),
        headers: { 'content-type': 'application/json' },
        payload: nested,
      });
      // Must be a clean client error — never a 5xx crash or a hang.
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  // ─── Pagination-limit abuse ─────────────────────────────────────────────────

  describe('pagination limit abuse (MAX_LIMIT = 100)', () => {
    async function superAdminToken(): Promise<string> {
      const user = await createTestUser();
      return generateSuperAdminToken(user.public_id);
    }

    it('rejects limit far above MAX_LIMIT', async () => {
      const token = await superAdminToken();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs?limit=9999999'),
        token,
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('rejects a zero / negative limit', async () => {
      const token = await superAdminToken();
      for (const limit of ['0', '-5']) {
        const response = await injectAuthenticated(app, {
          method: 'GET',
          url: testApiPath(`/audit/logs?limit=${limit}`),
          token,
        });
        expect([400, 422]).toContain(response.statusCode);
      }
    });

    it('rejects a non-numeric limit', async () => {
      const token = await superAdminToken();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/audit/logs?limit=not-a-number'),
        token,
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  // ─── ReDoS-shaped slug ──────────────────────────────────────────────────────

  describe('ReDoS-shaped slug input', () => {
    it('validates a pathological slug in bounded time and rejects it (no catastrophic backtracking)', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });

      // Crafted to trigger backtracking against /^[a-z0-9]+(?:-[a-z0-9]+)*$/:
      // many "-a" segments followed by a character that fails the anchor.
      const pathologicalSlug = `a${'-a'.repeat(2_000)}_`;

      const start = Date.now();
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        token,
        payload: { name: 'Acme Inc', slug: pathologicalSlug },
        headers: { 'x-idempotency-key': generatePublicId('user') },
      });
      const elapsedMs = Date.now() - start;

      // Rejected for an invalid slug, and the regex did not hang the worker.
      expect([400, 422]).toContain(response.statusCode);
      expect(elapsedMs).toBeLessThan(2_000);
    });
  });
});
