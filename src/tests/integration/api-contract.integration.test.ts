import { describe, expect, it, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

describe('API contract (integration)', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /health/ready returns database, redis, and bullmq status', async () => {
    const testApp = await createTestApp();
    app = testApp.app;

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/health/ready',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      database: string;
      redis: string;
      bullmq: string;
      latencyMs: { database: number; redis: number; bullmq: number };
    };
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
    expect(body.redis).toBe('connected');
    expect(body.bullmq).toBe('connected');
    expect(body.latencyMs).toMatchObject({
      database: expect.any(Number),
      redis: expect.any(Number),
      bullmq: expect.any(Number),
    });
  });

  it('POST /api/v1/auth/login rejects empty body with validation error', async () => {
    const testApp = await createTestApp();
    app = testApp.app;

    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {},
    });
    expect([400, 422]).toContain(response.statusCode);
  });

  it('GET /api/v1/users/me returns profile for valid token', async () => {
    await cleanupDatabase();
    const testApp = await createTestApp();
    app = testApp.app;

    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/api/v1/users/me',
      token,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { id: string } };
    expect(body.data.id).toBe(user.public_id);
  });

  it('GET /api/v1/billing/plans returns 200 without authentication', async () => {
    const testApp = await createTestApp();
    app = testApp.app;

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/api/v1/billing/plans',
    });
    expect(response.statusCode).toBe(200);
  });

  it('GET /api/v1/billing/plans returns a list for authenticated callers', async () => {
    await cleanupDatabase();
    const testApp = await createTestApp();
    app = testApp.app;

    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/api/v1/billing/plans',
      token,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});
