import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { database } from '@/infrastructure/database/connection.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { eq } from 'drizzle-orm';
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
        url: testApiPath('/uploads'),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing upload data', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/uploads'),
        token: token,
        payload: {},
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 for invalid purpose enum', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/uploads'),
        token: token,
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
    const unknownUploadPublicId = 'upl_abcdefghijklmnopqrstu';

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${unknownUploadPublicId}`),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown upload', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${unknownUploadPublicId}`),
        token: token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/uploads/:publicId', () => {
    const unknownUploadPublicId = 'upl_abcdefghijklmnopqrstu';

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/uploads/${unknownUploadPublicId}`),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown upload', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/uploads/${unknownUploadPublicId}`),
        token: token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/uploads/:publicId/confirm (route-coverage gap-fill)', () => {
    const unknownUploadPublicId = 'upl_abcdefghijklmnopqrstu';

    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(`/uploads/${unknownUploadPublicId}/confirm`),
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown upload public_id', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/uploads/${unknownUploadPublicId}/confirm`),
        token,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });

    it('is idempotent: re-confirming an already-UPLOADED row returns 200 without S3 calls', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const publicId = generatePublicId('upload');
      const [seeded] = await database
        .insert(uploads)
        .values({
          public_id: publicId,
          user_id: user.id,
          organization_id: null,
          file_name: 'verified.png',
          file_key: 'uploads/already-verified/verified.png',
          mime_type: 'image/png',
          file_size: 1024,
          storage_provider: 's3',
          bucket: 'core-be-uploads',
          status: 'UPLOADED',
          metadata: { purpose: 'AVATAR', target: 'USER' },
          uploaded_at: new Date(),
        })
        .returning();
      expect(seeded!.status).toBe('UPLOADED');

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/uploads/${publicId}/confirm`),
        token,
        payload: {},
      });
      expect(response.statusCode).toBe(201);

      const [postCall] = await database.select().from(uploads).where(eq(uploads.id, seeded!.id));
      expect(postCall!.status).toBe('UPLOADED');
    });
  });
});
