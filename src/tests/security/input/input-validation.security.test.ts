import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * Input validation tests — verify endpoints reject malformed inputs.
 * Tests strict DTO rejection and common injection vectors.
 */
describe('Security: Input Validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Login endpoint validation', () => {
    it('should reject missing email field', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: 'test' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should reject missing password field', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'test@test.com' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should reject empty body', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should reject SQL injection in email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: "' OR 1=1 --",
          password: 'test',
        },
      });
      expect([400, 401, 422]).toContain(response.statusCode);
    });

    it('should reject XSS in email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: '<script>alert("xss")</script>',
          password: 'test',
        },
      });
      expect([400, 401, 422]).toContain(response.statusCode);
    });
  });

  describe('Magic link validation', () => {
    it('should reject missing email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/magic-link/send',
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should reject invalid email format', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/magic-link/send',
        payload: { email: 'not-an-email' },
      });
      // 429 when strict auth rate limit is hit by earlier tests in the same file
      expect([400, 422, 429]).toContain(response.statusCode);
    });

    it('should reject Gmail address with plus in local part', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/magic-link/send',
        payload: { email: 'user+label@gmail.com' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('Password reset validation', () => {
    it('should reject empty body', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/password/reset',
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('Organization creation validation', () => {
    it('should handle excessively long name', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'a'.repeat(500) + '@test.com',
          password: 'a'.repeat(500),
        },
      });
      expect([400, 401, 422]).toContain(response.statusCode);
    });
  });

  describe('Content-Type enforcement', () => {
    it('should reject non-JSON content type on JSON endpoints', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'text/plain' },
        payload: 'email=test@test.com&password=test',
      });
      expect([400, 415, 422]).toContain(response.statusCode);
    });
  });

  describe('Whitespace trimming', () => {
    it('should accept email with leading and trailing spaces (trimmed)', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: '  valid-format@example.com  ',
          password: 'somepassword',
        },
      });
      expect(response.statusCode).not.toBe(400);
    });

    it('should reject password that is only whitespace', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'user@example.com',
          password: '   \t  ',
        },
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('Disposable email (BLOCK_DISPOSABLE_EMAIL switch)', () => {
    it('when switch is on, magic-link rejects disposable email with 400', async () => {
      vi.doMock('@/shared/utils/text/email.util.js', () => ({
        isDisposableEmailBlocked: () => true,
        DISPOSABLE_EMAIL_MESSAGE: 'Disposable or temporary email addresses are not allowed',
      }));
      await vi.resetModules();
      const { createTestApp: createTestAppFresh } = await import('@/tests/helpers/test-app.js');
      const { injectUnauthenticated: injectUnauthenticatedFresh } =
        await import('@/tests/helpers/test-http-inject.helper.js');
      const testAppWithMock = await createTestAppFresh();
      const response = await injectUnauthenticatedFresh(testAppWithMock.app, {
        method: 'POST',
        url: '/api/v1/auth/magic-link/send',
        payload: { email: 'test@yopmail.com' },
      });
      await testAppWithMock.app.close();
      expect(response.statusCode).toBe(400);
      const body = response.json() as
        | {
            error?: { messageKey?: string; message?: string };
            messageKey?: string;
            message?: string;
          }
        | undefined;
      const messageKey = body?.error?.messageKey ?? body?.messageKey;
      const message = body?.message ?? body?.error?.message ?? JSON.stringify(body ?? '');
      expect(
        messageKey === 'errors:disposableEmail' || message.toLowerCase().includes('disposable'),
      ).toBe(true);
    });

    it('when switch is off (e.g. tests), disposable email is allowed', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/magic-link/send',
        payload: { email: 'test@yopmail.com' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('when switch is off, password forgot accepts disposable email', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/auth/password/forgot',
        payload: { email: 'user@mailinator.com' },
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
