import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * sec-A8: regression suite for the shared login-audit helper.
 *
 * auth.overview.md promises "every login (success or failure) records a row" in
 * audit.events, but before this helper only the password-login success path
 * called `recordScopedAuditEvent`. OAuth, magic-link, and WebAuthn success
 * paths emitted nothing — making credential-stuffing / brute-force detection
 * harder than the documentation implied and leaving each non-password login
 * surface invisible in incident-response queries against `audit.events`.
 *
 * The helper centralizes the auth.login row and the super_admin escalation
 * event so every login outcome flows through one code path that records both,
 * with a uniform `source` discriminator and a non-fatal error sink (a failed
 * audit must never break the user-visible login).
 */

const { recordScopedAuditEventSpy, verifyAccessTokenSpy, loggerWarnSpy } = vi.hoisted(() => ({
  recordScopedAuditEventSpy: vi.fn().mockResolvedValue(undefined),
  verifyAccessTokenSpy: vi.fn(),
  loggerWarnSpy: vi.fn(),
}));

vi.mock('@/shared/utils/infrastructure/audit-request-context.util.js', () => ({
  recordScopedAuditEvent: recordScopedAuditEventSpy,
}));

vi.mock('@/shared/utils/security/jwt.util.js', () => ({
  verifyAccessToken: verifyAccessTokenSpy,
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: loggerWarnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  recordLoginAuditEvent,
  recordLoginFailureAuditEvent,
} from '@/domains/auth/shared/audit-login.util.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';

const request = { id: 'req_test' } as never;
const sessionResult = {
  access_token: 'opaque-jwt',
  session_public_id: 'sess_public_test',
  session_refresh_secret: 'refresh-secret',
};

describe('recordLoginAuditEvent (sec-A8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordScopedAuditEventSpy.mockResolvedValue(undefined);
  });

  it('records an auth.login event with the source discriminator', async () => {
    verifyAccessTokenSpy.mockResolvedValueOnce({
      userId: 'user_alice',
      role: 'USER',
    });

    await recordLoginAuditEvent(request, sessionResult, 'magic_link');

    expect(recordScopedAuditEventSpy).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        actorUserPublicId: 'user_alice',
        action: 'auth.login',
        resource_type: 'session',
        metadata: expect.objectContaining({
          session_public_id: 'sess_public_test',
          source: 'magic_link',
        }),
      }),
    );
  });

  it('also records super_admin.token_issued (WARNING) when role is SUPER_ADMIN', async () => {
    verifyAccessTokenSpy.mockResolvedValueOnce({
      userId: 'user_admin',
      role: GLOBAL_ROLES.SUPER_ADMIN,
    });

    await recordLoginAuditEvent(request, sessionResult, 'oauth_google');

    // Every platform super_admin token issuance is a break-glass moment and
    // must be visible alongside the auth.login row.
    expect(recordScopedAuditEventSpy).toHaveBeenCalledTimes(2);
    expect(recordScopedAuditEventSpy).toHaveBeenNthCalledWith(
      2,
      request,
      expect.objectContaining({
        actorUserPublicId: 'user_admin',
        action: 'auth.super_admin.token_issued',
        resource_type: 'session',
        severity: 'WARNING',
        metadata: expect.objectContaining({
          session_public_id: 'sess_public_test',
          source: 'oauth_google',
        }),
      }),
    );
  });

  it('does NOT emit the super_admin event for non-admin roles (control case)', async () => {
    verifyAccessTokenSpy.mockResolvedValueOnce({
      userId: 'user_bob',
      role: 'USER',
    });

    await recordLoginAuditEvent(request, sessionResult, 'webauthn');

    expect(recordScopedAuditEventSpy).toHaveBeenCalledTimes(1);
    const calls = recordScopedAuditEventSpy.mock.calls;
    expect(calls.every(([, payload]) => payload.action !== 'auth.super_admin.token_issued')).toBe(
      true,
    );
  });

  it('swallows audit-pipeline errors so the user-visible login is never broken', async () => {
    verifyAccessTokenSpy.mockResolvedValueOnce({ userId: 'user_e', role: 'USER' });
    recordScopedAuditEventSpy.mockRejectedValueOnce(new Error('audit write failed'));

    await expect(recordLoginAuditEvent(request, sessionResult, 'password')).resolves.not.toThrow();
    // The failure path logs but does NOT propagate (login UX is not held hostage
    // by an audit-store outage).
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'audit.login.recording.failed',
    );
  });

  it('swallows JWT-verify errors (token already present in cookie / body remains valid)', async () => {
    verifyAccessTokenSpy.mockRejectedValueOnce(new Error('verify failed'));

    await expect(recordLoginAuditEvent(request, sessionResult, 'password')).resolves.not.toThrow();
    expect(recordScopedAuditEventSpy).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalled();
  });

  // sec-A8 follow-up: closes the symmetric failure side of every login
  // surface. recordLoginFailureAuditEvent never records actorUserPublicId —
  // we deliberately don't know who they tried to log in as, so the row
  // captures only source + error_code + IP/UA (the latter via the
  // recordScopedAuditEvent network helper). Best-effort throughout: a
  // recording failure must not break the caller's re-throw.
  describe('recordLoginFailureAuditEvent (sec-A8 follow-up)', () => {
    it('records auth.login_failure with source and a typed error_code from AppError messageKey', async () => {
      class FakeAppError extends Error {
        public readonly messageKey = 'errors:invalidEmailOrPassword';
        constructor() {
          super('Invalid email or password');
          this.name = 'UnauthorizedError';
        }
      }

      await recordLoginFailureAuditEvent(request, 'password', new FakeAppError());

      expect(recordScopedAuditEventSpy).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          action: 'auth.login_failure',
          resource_type: 'session',
          severity: 'INFO',
          metadata: expect.objectContaining({
            source: 'password',
            error_code: 'errors:invalidEmailOrPassword',
          }),
        }),
      );
      // CRITICAL: failure rows must NOT name an actor — we don't trust the
      // attacker's claim of identity, and naming a victim would leak existence.
      const [, payload] = recordScopedAuditEventSpy.mock.calls.at(-1) ?? [];
      expect((payload as { actorUserPublicId?: string })?.actorUserPublicId).toBeUndefined();
    });

    it('falls back to error.name when no messageKey is present (plain Error)', async () => {
      const plainError = new Error('boom');

      await recordLoginFailureAuditEvent(request, 'oauth_google', plainError);

      const [, payload] = recordScopedAuditEventSpy.mock.calls.at(-1) ?? [];
      expect((payload as { metadata?: { error_code?: string } })?.metadata?.error_code).toBe(
        'Error',
      );
      expect((payload as { metadata?: { source?: string } })?.metadata?.source).toBe(
        'oauth_google',
      );
    });

    it('falls back to "unknown" error_code when error is a non-Error throw value', async () => {
      await recordLoginFailureAuditEvent(request, 'webauthn', 'some-string-thrown');

      const [, payload] = recordScopedAuditEventSpy.mock.calls.at(-1) ?? [];
      expect((payload as { metadata?: { error_code?: string } })?.metadata?.error_code).toBe(
        'unknown',
      );
    });

    it('swallows audit-pipeline errors so the caller can re-throw the original', async () => {
      recordScopedAuditEventSpy.mockRejectedValueOnce(new Error('audit pipeline down'));

      await expect(
        recordLoginFailureAuditEvent(request, 'magic_link', new Error('boom')),
      ).resolves.not.toThrow();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'audit.login_failure.recording.failed',
      );
    });
  });
});
