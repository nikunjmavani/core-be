import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';

const OPENAPI_SPEC_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');

function getContentSecurityPolicyHeader(
  headers: Record<string, string | string[] | undefined>,
): string {
  const value = headers['content-security-policy'] ?? headers['Content-Security-Policy'] ?? '';
  return Array.isArray(value) ? value.join('; ') : String(value);
}

function assertCspHasNoUnsafeInline(contentSecurityPolicy: string): void {
  expect(contentSecurityPolicy.length).toBeGreaterThan(0);
  const normalized = contentSecurityPolicy.toLowerCase();
  expect(normalized).not.toContain('unsafe-inline');
  expect(normalized).not.toContain('unsafe-eval');
}

function ensureOpenApiSpecExists(): void {
  if (!existsSync(OPENAPI_SPEC_PATH)) {
    execSync('pnpm docs:generate', { stdio: 'pipe' });
  }
}

describe('Security: Content-Security-Policy (Helmet)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets CSP on API routes without unsafe-inline or unsafe-eval', async () => {
    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: '/health',
    });

    const contentSecurityPolicy = getContentSecurityPolicyHeader(response.headers);
    assertCspHasNoUnsafeInline(contentSecurityPolicy);
    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).toContain("style-src 'self'");
    expect(contentSecurityPolicy).toContain('frame-ancestors');
  });

  describe('Scalar API reference (/reference)', () => {
    let referenceApp: FastifyInstance;
    const previousEnableApiReference = process.env.ENABLE_API_REFERENCE;
    const previousOpenApiSpecPath = process.env.OPENAPI_SPEC_PATH;

    beforeAll(async () => {
      ensureOpenApiSpecExists();
      process.env.ENABLE_API_REFERENCE = 'true';
      process.env.OPENAPI_SPEC_PATH = 'docs/openapi/openapi.json';
      resetEnvCacheForTests();
      const { app: testApplication } = await createTestApp();
      referenceApp = testApplication;
    });

    afterAll(async () => {
      await referenceApp.close();
      if (previousEnableApiReference === undefined) {
        delete process.env.ENABLE_API_REFERENCE;
      } else {
        process.env.ENABLE_API_REFERENCE = previousEnableApiReference;
      }
      if (previousOpenApiSpecPath === undefined) {
        delete process.env.OPENAPI_SPEC_PATH;
      } else {
        process.env.OPENAPI_SPEC_PATH = previousOpenApiSpecPath;
      }
      resetEnvCacheForTests();
    });

    it('loads HTML at GET /reference/ with a strict CSP (no unsafe-inline)', async () => {
      const response = await injectUnauthenticated(referenceApp, {
        method: 'GET',
        url: '/reference/',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.body).toContain('scalar');

      const contentSecurityPolicy = getContentSecurityPolicyHeader(response.headers);
      assertCspHasNoUnsafeInline(contentSecurityPolicy);
    });
  });
});
