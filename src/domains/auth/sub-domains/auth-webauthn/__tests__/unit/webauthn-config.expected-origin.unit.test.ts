import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/shared/errors/index.js';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    ALLOWED_ORIGINS: undefined,
    WEBAUTHN_RP_ID: undefined,
    WEBAUTHN_RP_NAME: undefined,
  } as {
    ALLOWED_ORIGINS: string | undefined;
    WEBAUTHN_RP_ID: string | undefined;
    WEBAUTHN_RP_NAME: string | undefined;
  },
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: mockEnv,
}));

import { resolveWebauthnExpectedOrigin } from '../../webauthn.config.js';

describe('resolveWebauthnExpectedOrigin — trusted-origin allowlist (bug 39)', () => {
  afterEach(() => {
    mockEnv.ALLOWED_ORIGINS = undefined;
    mockEnv.WEBAUTHN_RP_ID = undefined;
    mockEnv.WEBAUTHN_RP_NAME = undefined;
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
});
