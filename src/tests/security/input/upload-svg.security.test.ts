import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';

function expectSvgUploadRejected(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(400);
  const body = response.json() as {
    error?: {
      type?: string;
      detail?: string;
      errors?: Array<{ field: string; message: string }>;
    };
  };
  expect(body.error?.type).toBe('validation_error');
  const detail = body.error?.detail?.toLowerCase() ?? '';
  const contentTypeMessage =
    body.error?.errors?.find((fieldError) => fieldError.field === 'content_type')?.message ?? '';
  const combined = `${detail} ${contentTypeMessage.toLowerCase()}`;
  expect(
    combined.includes('svg') ||
      combined.includes('not allowed') ||
      combined.includes('notallowed') ||
      combined.includes('uploadcontenttype'),
  ).toBe(true);
}

describe('Security: SVG upload blocking', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/uploads rejects image/svg+xml with 400', async () => {
    await cleanupDatabase();
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/uploads'),
      token,
      payload: {
        purpose: 'avatar',
        for: 'user',
        content_type: 'image/svg+xml',
        file_name: 'avatar.svg',
        file_size: 1024,
      },
    });

    expectSvgUploadRejected(response);
  });
});
