import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';

/**
 * Upload request-validation attack coverage.
 *
 * Uploads use a presigned-URL flow: the API never receives the file bytes at the
 * request-upload step, so byte-level vectors (XXE, EICAR, polyglot, magic-byte
 * mismatch) are enforced later at the confirm step (S3 HEAD + magic-byte verify)
 * and belong in a separate confirm-step integration test. These tests attack the
 * request-upload validator — the metadata surface a client fully controls:
 * dangerous content types, content-type↔extension mismatch, hostile filenames,
 * oversized declarations, and `for`/`organizationId` scope confusion.
 *
 * (SVG blocking is covered separately in `upload-svg.security.test.ts`.)
 */
const UPLOAD_URL = '/uploads';

function expectUploadRejected(statusCode: number): void {
  expect(statusCode).not.toBe(201);
  expect(statusCode).not.toBe(200);
  expect([400, 403, 422]).toContain(statusCode);
}

describe('Security: upload request-validation attacks', () => {
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

  async function userToken(): Promise<string> {
    const user = await createTestUser();
    return generateTestToken({ userId: user.public_id });
  }

  async function requestAvatarUpload(
    token: string,
    overrides: Record<string, unknown>,
  ): Promise<number> {
    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(UPLOAD_URL),
      token,
      payload: {
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'avatar.png',
        fileSize: 1024,
        ...overrides,
      },
    });
    return response.statusCode;
  }

  // ─── Baseline ───────────────────────────────────────────────────────────────

  it('baseline: a valid avatar upload request is accepted', async () => {
    const token = await userToken();
    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(UPLOAD_URL),
      token,
      payload: {
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'avatar.png',
        fileSize: 1024,
      },
    });
    expect(response.statusCode).toBe(201);
  });

  // ─── Dangerous content types ────────────────────────────────────────────────

  describe('content-type allowlist', () => {
    it.each([
      'text/html',
      'application/javascript',
      'application/x-msdownload',
      'application/x-sh',
      'text/x-php',
      'application/octet-stream',
    ])('rejects a dangerous content type: %s', async (contentType) => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        contentType,
        fileName: 'avatar.png',
      });
      expectUploadRejected(status);
    });
  });

  // ─── Content-type ↔ extension mismatch ──────────────────────────────────────

  describe('content-type / extension mismatch', () => {
    it('rejects a filename whose extension does not match the content type', async () => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        contentType: 'image/png',
        fileName: 'evil.pdf',
      });
      expectUploadRejected(status);
    });

    it('rejects a double extension with a mismatched final extension (evil.png.php)', async () => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        contentType: 'image/png',
        fileName: 'evil.png.php',
      });
      expectUploadRejected(status);
    });
  });

  // ─── Hostile filenames ──────────────────────────────────────────────────────

  describe('hostile filenames', () => {
    it.each([
      '../../etc/passwd',
      '../../../var/www/shell.png',
      '..\\..\\windows\\system32\\evil.png',
      '/absolute/path/avatar.png',
    ])('rejects a path-traversal filename: %s', async (fileName) => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        contentType: 'image/png',
        fileName,
      });
      expectUploadRejected(status);
    });
  });

  // ─── Oversized declaration ──────────────────────────────────────────────────

  describe('declared file size', () => {
    it('rejects an avatar larger than the per-purpose limit', async () => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        fileSize: 50 * 1024 * 1024, // 50 MB — far over the avatar limit
      });
      expectUploadRejected(status);
    });

    it('rejects a zero / negative declared file size', async () => {
      const token = await userToken();
      for (const fileSize of [0, -1]) {
        const status = await requestAvatarUpload(token, { fileSize });
        expectUploadRejected(status);
      }
    });
  });

  // ─── Scope confusion ────────────────────────────────────────────────────────

  describe('for / organizationId scope confusion', () => {
    it('rejects a user upload that smuggles an organizationId', async () => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        for: 'user',
        organizationId: 'someone-elses-org',
      });
      expectUploadRejected(status);
    });

    it('rejects an organization upload with no organizationId', async () => {
      const token = await userToken();
      const status = await requestAvatarUpload(token, {
        purpose: 'organization-logo',
        for: 'organization',
        // organizationId intentionally omitted
      });
      expectUploadRejected(status);
    });
  });
});
