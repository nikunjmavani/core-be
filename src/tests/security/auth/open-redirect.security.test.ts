import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectRoute } from '@/tests/helpers/test-http-inject.helper.js';

/**
 * Open-redirect regression guards.
 *
 * The API is JSON-only: it issues NO HTTP redirects and accepts NO
 * client-controllable redirect target (no `?redirect_to=`, `next=`, `return_to=`).
 * The OAuth callback returns JSON; the SPA owns post-login navigation. That design
 * has no open-redirect surface — these tests lock it in so a future change cannot
 * silently reintroduce one:
 *  1. a source scan asserting no `reply.redirect(...)` is added, and
 *  2. HTTP behaviour: the OAuth callback never emits a 3xx / `Location`, and
 *     injected redirect parameters are rejected, never honored.
 */
const SOURCE_ROOT = resolve(process.cwd(), 'src');
const ATTACKER_TARGET = 'https://evil.example.com/steal';

/** Asserts the response is not an HTTP redirect (no 3xx status, no Location header). */
function expectNotRedirect(statusCode: number, location: string | string[] | undefined): void {
  const isRedirectStatus = statusCode >= 300 && statusCode < 400;
  expect(isRedirectStatus).toBe(false);
  expect(location).toBeUndefined();
}

function collectSourceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      // Skip test trees — guard production source only.
      if (entry === '__tests__' || entry === 'tests') continue;
      collectSourceFiles(fullPath, accumulator);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      accumulator.push(fullPath);
    }
  }
  return accumulator;
}

describe('Security: open-redirect regression guards', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Source scan: no redirects may be introduced ────────────────────────────

  describe('source scan', () => {
    it('production source issues no HTTP redirect (no reply.redirect / 3xx Location)', () => {
      const offenders: string[] = [];
      for (const file of collectSourceFiles(SOURCE_ROOT)) {
        const contents = readFileSync(file, 'utf8');
        // `reply.redirect(...)`, `.redirect(<url>)`, or a manual 30x Location.
        if (/\breply\.redirect\s*\(/.test(contents)) {
          offenders.push(`${file}: reply.redirect()`);
        }
        // 301/302/303/307/308 statuses (304 Not Modified is a cache response, allowed).
        if (/\b(?:status|code)\s*\(\s*30[12356789]\s*\)/.test(contents)) {
          offenders.push(`${file}: 3xx redirect status`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ─── OAuth callback never redirects ─────────────────────────────────────────

  describe('OAuth callback', () => {
    it('does not honor an injected redirect_to parameter (rejected, never a 3xx)', async () => {
      const response = await injectRoute(app, {
        method: 'GET',
        url: testApiPath(
          `/auth/oauth/google/callback?code=abc&state=xyz&redirect_to=${encodeURIComponent(ATTACKER_TARGET)}`,
        ),
      });
      // Strict callback DTO rejects unknown params; in no case is it a redirect.
      expect([400, 401, 422]).toContain(response.statusCode);
      expectNotRedirect(response.statusCode, response.headers.location);
    });

    it('does not honor injected next / return_to / returnUrl parameters', async () => {
      for (const parameter of ['next', 'return_to', 'returnUrl', 'callbackUrl']) {
        const response = await injectRoute(app, {
          method: 'GET',
          url: testApiPath(
            `/auth/oauth/google/callback?code=abc&state=xyz&${parameter}=${encodeURIComponent(ATTACKER_TARGET)}`,
          ),
        });
        expectNotRedirect(response.statusCode, response.headers.location);
      }
    });

    it('returns a JSON error (not a 3xx redirect) for an unknown state', async () => {
      const response = await injectRoute(app, {
        method: 'GET',
        url: testApiPath('/auth/oauth/google/callback?code=abc&state=unknown-state-token'),
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers.location).toBeUndefined();
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('does not redirect even when state itself is a URL (no reflection into Location)', async () => {
      const response = await injectRoute(app, {
        method: 'GET',
        url: testApiPath(
          `/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(ATTACKER_TARGET)}`,
        ),
      });
      expectNotRedirect(response.statusCode, response.headers.location);
    });
  });
});
