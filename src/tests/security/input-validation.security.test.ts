import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestApp, type TestRequestAgent } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Input validation tests — verify endpoints reject malformed inputs.
 * Tests strict DTO rejection and common injection vectors.
 */
describe('Security: Input Validation', () => {
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

  describe('Login endpoint validation', () => {
    it('should reject missing email field', async () => {
      const response = await request.post('/api/v1/auth/login').send({ password: 'test' });
      expect([400, 422]).toContain(response.status);
    });

    it('should reject missing password field', async () => {
      const response = await request.post('/api/v1/auth/login').send({ email: 'test@test.com' });
      expect([400, 422]).toContain(response.status);
    });

    it('should reject empty body', async () => {
      const response = await request.post('/api/v1/auth/login').send({});
      expect([400, 422]).toContain(response.status);
    });

    it('should reject SQL injection in email', async () => {
      const response = await request.post('/api/v1/auth/login').send({
        email: "' OR 1=1 --",
        password: 'test',
      });
      expect([400, 401, 422]).toContain(response.status);
    });

    it('should reject XSS in email', async () => {
      const response = await request.post('/api/v1/auth/login').send({
        email: '<script>alert("xss")</script>',
        password: 'test',
      });
      expect([400, 401, 422]).toContain(response.status);
    });
  });

  describe('Magic link validation', () => {
    it('should reject missing email', async () => {
      const response = await request.post('/api/v1/auth/magic-link/send').send({});
      expect([400, 422]).toContain(response.status);
    });

    it('should reject invalid email format', async () => {
      const response = await request.post('/api/v1/auth/magic-link/send').send({
        email: 'not-an-email',
      });
      // 429 when strict auth rate limit is hit by earlier tests in the same file
      expect([400, 422, 429]).toContain(response.status);
    });

    it('should reject Gmail address with plus in local part', async () => {
      const response = await request.post('/api/v1/auth/magic-link/send').send({
        email: 'user+label@gmail.com',
      });
      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Password reset validation', () => {
    it('should reject empty body', async () => {
      const response = await request.post('/api/v1/auth/password/reset').send({});
      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Organization creation validation', () => {
    it('should handle excessively long name', async () => {
      const response = await request.post('/api/v1/auth/login').send({
        email: 'a'.repeat(500) + '@test.com',
        password: 'a'.repeat(500),
      });
      expect([400, 401, 422]).toContain(response.status);
    });
  });

  describe('Content-Type enforcement', () => {
    it('should reject non-JSON content type on JSON endpoints', async () => {
      const response = await request
        .post('/api/v1/auth/login')
        .set('Content-Type', 'text/plain')
        .send('email=test@test.com&password=test');
      expect([400, 415, 422]).toContain(response.status);
    });
  });

  describe('Whitespace trimming', () => {
    it('should accept email with leading and trailing spaces (trimmed)', async () => {
      const response = await request.post('/api/v1/auth/login').send({
        email: '  valid-format@example.com  ',
        password: 'somepassword',
      });
      expect(response.status).not.toBe(400);
    });

    it('should reject password that is only whitespace', async () => {
      const response = await request.post('/api/v1/auth/login').send({
        email: 'user@example.com',
        password: '   \t  ',
      });
      expect([400, 422]).toContain(response.status);
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
      const testAppWithMock = await createTestAppFresh();
      const mockRequest = testAppWithMock.request;
      const response = await mockRequest
        .post('/api/v1/auth/magic-link/send')
        .send({ email: 'test@yopmail.com' });
      await testAppWithMock.app.close();
      expect(response.status).toBe(400);
      const body = response.body as {
        error?: { messageKey?: string; message?: string };
        messageKey?: string;
        message?: string;
      };
      const messageKey = body.error?.messageKey ?? body.messageKey;
      const message = body.message ?? body.error?.message ?? JSON.stringify(response.body ?? '');
      expect(
        messageKey === 'errors:disposableEmail' || message.toLowerCase().includes('disposable'),
      ).toBe(true);
    });

    it('when switch is off (e.g. tests), disposable email is allowed', async () => {
      const response = await request
        .post('/api/v1/auth/magic-link/send')
        .send({ email: 'test@yopmail.com' });
      expect(response.status).toBe(200);
    });

    it('when switch is off, password forgot accepts disposable email', async () => {
      const response = await request
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'user@mailinator.com' });
      expect(response.status).toBe(200);
    });
  });
});
