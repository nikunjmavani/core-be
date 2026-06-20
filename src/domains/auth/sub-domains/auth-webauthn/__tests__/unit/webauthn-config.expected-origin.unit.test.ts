import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/shared/errors/index.js';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    ALLOWED_ORIGINS: undefined,
    WEBAUTHN_RP_ID: undefined,
    WEBAUTHN_RP_NAME: undefined,
    FRONTEND_URL: undefined,
  } as {
    ALLOWED_ORIGINS: string | undefined;
    WEBAUTHN_RP_ID: string | undefined;
    WEBAUTHN_RP_NAME: string | undefined;
    FRONTEND_URL: string | undefined;
  },
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
}));

import { resolveWebauthnExpectedOrigin } from '@/domains/auth/sub-domains/auth-webauthn/webauthn.config.js';

describe('resolveWebauthnExpectedOrigin — trusted-origin allowlist (bug 39)', () => {
  afterEach(() => {
    mockEnv.ALLOWED_ORIGINS = undefined;
    mockEnv.WEBAUTHN_RP_ID = undefined;
    mockEnv.WEBAUTHN_RP_NAME = undefined;
    mockEnv.FRONTEND_URL = undefined;
  });

  it('rejects a spoofed Origin header that is not in the allowlist before verification', () => {
    mockEnv.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';

    expect(() => resolveWebauthnExpectedOrigin('https://evil.example')).toThrow(ForbiddenError);
    expect(() => resolveWebauthnExpectedOrigin('https://evil.example')).toThrow(
      'errors:originNotAllowed',
    );
  });

  it('accepts a request origin that exactly matches an allowlisted origin', () => {
    mockEnv.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';

    expect(resolveWebauthnExpectedOrigin('https://admin.example.com')).toBe(
      'https://admin.example.com',
    );
  });

  it('does not accept a path/suffix variation of an allowlisted origin', () => {
    mockEnv.ALLOWED_ORIGINS = 'https://app.example.com';

    expect(() => resolveWebauthnExpectedOrigin('https://app.example.com.evil.test')).toThrow(
      ForbiddenError,
    );
  });

  it('falls back to the single canonical origin when no request origin is present', () => {
    mockEnv.ALLOWED_ORIGINS = 'https://app.example.com';

    expect(resolveWebauthnExpectedOrigin(undefined)).toBe('https://app.example.com');
    expect(resolveWebauthnExpectedOrigin('')).toBe('https://app.example.com');
  });

  it('falls back to the full allowlist (never the caller) when origin missing and many configured', () => {
    mockEnv.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';

    expect(resolveWebauthnExpectedOrigin(undefined)).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('never trusts a caller origin even when no allowlist is configured', () => {
    mockEnv.ALLOWED_ORIGINS = undefined;
    mockEnv.WEBAUTHN_RP_ID = 'app.example.com';

    expect(resolveWebauthnExpectedOrigin('https://evil.example')).toBe('https://app.example.com');
  });

  // EX-35: the localhost dev origin must be config-derived, not a hardcoded port.
  it('uses the conventional dev origin for a localhost RP id when FRONTEND_URL is unset', () => {
    mockEnv.ALLOWED_ORIGINS = undefined;
    mockEnv.WEBAUTHN_RP_ID = undefined; // resolves RP id to "localhost"
    mockEnv.FRONTEND_URL = undefined;

    expect(resolveWebauthnExpectedOrigin(undefined)).toBe('http://localhost:3000');
  });

  it('derives the localhost dev origin from FRONTEND_URL when set (non-default dev port)', () => {
    mockEnv.ALLOWED_ORIGINS = undefined;
    mockEnv.WEBAUTHN_RP_ID = undefined; // resolves RP id to "localhost"
    mockEnv.FRONTEND_URL = 'http://localhost:5173/app'; // path stripped → origin only

    expect(resolveWebauthnExpectedOrigin(undefined)).toBe('http://localhost:5173');
  });
});
