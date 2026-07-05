import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ForbiddenError } from '@/shared/errors/index.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/domains/auth/auth.http.util.js';

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
    NODE_ENV: 'development',
  },
}));

import { requireAllowedSourceOriginForCookieSessionRoute } from '@/shared/middlewares/session/cookie-session-origin.pre-handler.js';

describe('cookie-session-origin.pre-handler', () => {
  it('rejects when both Origin and Referer are absent', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: {},
      } as unknown as FastifyRequest),
    ).toThrow(ForbiddenError);
  });

  it('allows listed Origin headers', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: { origin: 'https://app.example.com' },
      } as unknown as FastifyRequest),
    ).not.toThrow();
  });

  it('rejects origins that are not on the allowlist', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: { origin: 'https://evil.example.com' },
      } as unknown as FastifyRequest),
    ).toThrow(ForbiddenError);
  });

  it('uses the first origin when Origin is sent as an array', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: { origin: ['https://app.example.com', 'https://ignored.example.com'] },
      } as unknown as FastifyRequest),
    ).not.toThrow();
  });

  it('allows missing Origin when Referer origin is on the allowlist', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: { referer: 'https://app.example.com/dashboard' },
      } as unknown as FastifyRequest),
    ).not.toThrow();
  });

  it('rejects missing Origin when Referer origin is not on the allowlist', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: { referer: 'https://evil.example.com/login' },
      } as unknown as FastifyRequest),
    ).toThrow(ForbiddenError);
  });

  it('validates Origin only when both Origin and Referer are present', () => {
    expect(() =>
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: {
          origin: 'https://app.example.com',
          referer: 'https://evil.example.com/login',
        },
      } as unknown as FastifyRequest),
    ).not.toThrow();
  });

  it('rejects malformed Referer URLs', () => {
    try {
      requireAllowedSourceOriginForCookieSessionRoute({
        headers: { referer: 'not-a-valid-url' },
      } as unknown as FastifyRequest);
      expect.fail('expected ForbiddenError');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).messageKey).toBe('errors:invalidRefererOrigin');
    }
  });
});

describe('cookie-session-origin.pre-handler (empty allowlist)', () => {
  it('skips validation when ALLOWED_ORIGINS is empty', async () => {
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: { ALLOWED_ORIGINS: '', NODE_ENV: 'development' },
    }));
    const { requireAllowedSourceOriginForCookieSessionRoute: requireSourceOrigin } = await import(
      '@/shared/middlewares/session/cookie-session-origin.pre-handler.js'
    );
    expect(() =>
      requireSourceOrigin({
        headers: {},
      } as unknown as FastifyRequest),
    ).not.toThrow();
  });
});

describe('cookie-session-origin.pre-handler (production)', () => {
  it('rejects missing Origin when Referer is allowed but CSRF token is absent', async () => {
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        ALLOWED_ORIGINS: 'https://app.example.com',
        NODE_ENV: 'production',
        SESSION_ORIGIN_CSRF_REQUIRED: true,
      },
    }));
    const { requireAllowedSourceOriginForCookieSessionRoute: requireSourceOrigin } = await import(
      '@/shared/middlewares/session/cookie-session-origin.pre-handler.js'
    );
    try {
      requireSourceOrigin({
        headers: { referer: 'https://app.example.com/dashboard' },
        cookies: {},
      } as unknown as FastifyRequest);
      expect.fail('expected ForbiddenError');
    } catch (error) {
      expect((error as ForbiddenError).messageKey).toBe('errors:invalidCsrfToken');
    }
  });

  it('rejects missing Origin when CSRF header does not match cookie', async () => {
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        ALLOWED_ORIGINS: 'https://app.example.com',
        NODE_ENV: 'production',
        SESSION_ORIGIN_CSRF_REQUIRED: true,
      },
    }));
    const { requireAllowedSourceOriginForCookieSessionRoute: requireSourceOrigin } = await import(
      '@/shared/middlewares/session/cookie-session-origin.pre-handler.js'
    );
    try {
      requireSourceOrigin({
        headers: { [CSRF_HEADER_NAME]: 'header-token' },
        cookies: { [CSRF_COOKIE_NAME]: 'cookie-token' },
      } as unknown as FastifyRequest);
      expect.fail('expected ForbiddenError');
    } catch (error) {
      expect((error as ForbiddenError).messageKey).toBe('errors:invalidCsrfToken');
    }
  });

  it('allows missing Origin when CSRF double-submit matches', async () => {
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: {
        ALLOWED_ORIGINS: 'https://app.example.com',
        NODE_ENV: 'production',
        SESSION_ORIGIN_CSRF_REQUIRED: true,
      },
    }));
    const { requireAllowedSourceOriginForCookieSessionRoute: requireSourceOrigin } = await import(
      '@/shared/middlewares/session/cookie-session-origin.pre-handler.js'
    );
    const csrfToken = 'matching-csrf-token-value';
    expect(() =>
      requireSourceOrigin({
        headers: { [CSRF_HEADER_NAME]: csrfToken },
        cookies: { [CSRF_COOKIE_NAME]: csrfToken },
      } as unknown as FastifyRequest),
    ).not.toThrow();
  });
});
