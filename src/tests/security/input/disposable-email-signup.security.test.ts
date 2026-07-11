import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';
import type { InjectRouteOptions } from '@/tests/helpers/test-http-inject.helper.js';

const DISPOSABLE_EMAIL = 'test@yopmail.com';

function expectDisposableEmailRejected(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(400);
  const body = response.json() as { error?: { reason?: string } };
  // Assert the stable machine-readable `reason`, not the human `detail` — the
  // serializer resolves `errors:disposableEmail` to localized copy ("This email
  // domain is not allowed."), so the old raw-key/substring check no longer holds.
  expect(body.error?.reason).toBe('disposable_email');
}

describe('Security: Disposable email on auth signup paths (BLOCK_DISPOSABLE_EMAIL)', () => {
  let app: FastifyInstance;
  let injectUnauthenticated: (
    application: FastifyInstance,
    options: InjectRouteOptions,
  ) => Promise<{ statusCode: number; json: () => unknown }>;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('@/shared/utils/text/email.util.js', () => ({
      isDisposableEmailBlocked: () => true,
      DISPOSABLE_EMAIL_MESSAGE: 'Disposable or temporary email addresses are not allowed',
    }));
    const testAppModule = await import('@/tests/helpers/test-app.js');
    const injectModule = await import('@/tests/helpers/test-http-inject.helper.js');
    injectUnauthenticated = injectModule.injectUnauthenticated;
    const testApp = await testAppModule.createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
    vi.doUnmock('@/shared/utils/text/email.util.js');
    vi.resetModules();
  });

  it('POST /auth/login rejects disposable email with errors:disposableEmail', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email: DISPOSABLE_EMAIL, password: 'Password123!' },
    });
    expectDisposableEmailRejected(response);
  });

  it('POST /auth/email/send-code rejects disposable email with errors:disposableEmail', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/email/send-code'),
      payload: { email: DISPOSABLE_EMAIL },
    });
    expectDisposableEmailRejected(response);
  });

  it('POST /auth/password/forgot rejects disposable email with errors:disposableEmail', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/password/forgot'),
      payload: { email: DISPOSABLE_EMAIL },
    });
    expectDisposableEmailRejected(response);
  });
});
