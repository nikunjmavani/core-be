import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';

describe('Upload Domain — Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  describe('POST /api/v1/uploads', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: '/api/v1/uploads',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing upload data', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: '/api/v1/uploads',
        token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 for invalid purpose enum', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: '/api/v1/uploads',
        token,
        payload: {
          purpose: 'invalid-purpose',
          for: 'user',
          contentType: 'image/png',
          fileName: 'avatar.png',
          fileSize: 1024,
        },
      });
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('GET /api/v1/uploads/:publicId', () => {
    const unknownUploadPublicId = 'abcdefghijklmnopqrstu';

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: `/api/v1/uploads/${unknownUploadPublicId}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown upload', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        url: `/api/v1/uploads/${unknownUploadPublicId}`,
        token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/uploads/:publicId', () => {
    const unknownUploadPublicId = 'abcdefghijklmnopqrstu';

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: `/api/v1/uploads/${unknownUploadPublicId}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown upload', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: `/api/v1/uploads/${unknownUploadPublicId}`,
        token,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
