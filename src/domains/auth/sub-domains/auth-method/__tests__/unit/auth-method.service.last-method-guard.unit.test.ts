import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
import { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodRepository } from '@/domains/auth/sub-domains/auth-method/auth-method.repository.js';
import type { VerificationTokenRepository } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.repository.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';

vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn(async (_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

// Stable 21-char test public ids used across all scenarios in this suite.
const METHOD_PUB_A = 'testmethodpuba123456'; // being deleted
const METHOD_PUB_B = 'testmethodpubb123456'; // second method (e.g. OAUTH)
const METHOD_PUB_MFA = 'testmethodpubm12345'; // MFA_TOTP method

/**
 * Regression for sec-A5 (Medium): `DELETE /me/auth-methods/:publicId` previously called the
 * repository revoke without counting what would remain, so a user could revoke their
 * PASSWORD (or every OAUTH/MAGIC_LINK) credential and lock themselves out — every login
 * surface gone, recovery requires admin intervention.
 *
 * sec-new-B4: the route now accepts a `publicId` string path param instead of a bigserial
 * integer, and the service resolves by `findByPublicIdForUser` before revoking by internal id.
 */
describe('AuthMethodService.delete — last-method guard (sec-A5)', () => {
  const userService = {
    requireUserRecordByPublicId: vi.fn(),
    // sec-r5-auth-session-info-1: PASSWORD revocation now atomically clears
    // users.password_hash so the user-facing "I removed my password" view
    // matches the auth view. The service path calls this when the revoked
    // method's type is PASSWORD.
    clearPasswordHash: vi.fn().mockResolvedValue(null),
  } as unknown as UserService;

  const authMethodRepository = {
    findByPublicIdForUser: vi.fn(),
    listByUserId: vi.fn(),
    revoke: vi.fn(),
  } as unknown as AuthMethodRepository;

  const verificationTokenRepository = {} as VerificationTokenRepository;
  const authSessionService = {} as AuthSessionService;

  const service = new AuthMethodService(
    userService,
    authMethodRepository,
    verificationTokenRepository,
    authSessionService,
  );

  const user = { id: 1, public_id: 'user_pub' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue(user as never);
    vi.mocked(authMethodRepository.revoke).mockResolvedValue({ id: 42, user_id: 1 } as never);
  });

  it('refuses to delete the last login-capable method (PASSWORD only)', async () => {
    vi.mocked(authMethodRepository.findByPublicIdForUser).mockResolvedValue({
      id: 42,
      public_id: METHOD_PUB_A,
      user_id: 1,
      method_type: 'PASSWORD',
      revoked_at: null,
    } as never);
    // Only the method being deleted is login-capable — the user would have no way to log in.
    vi.mocked(authMethodRepository.listByUserId).mockResolvedValue([
      { id: 42, public_id: METHOD_PUB_A, user_id: 1, method_type: 'PASSWORD' },
      { id: 99, public_id: METHOD_PUB_MFA, user_id: 1, method_type: 'MFA_TOTP' }, // MFA is NOT login-capable on its own.
    ] as never);

    await expect(service.delete('user_pub', METHOD_PUB_A)).rejects.toBeInstanceOf(ForbiddenError);
    expect(authMethodRepository.revoke).not.toHaveBeenCalled();
  });

  it('allows deletion of one of several login-capable methods (PASSWORD when OAUTH remains)', async () => {
    vi.mocked(authMethodRepository.findByPublicIdForUser).mockResolvedValue({
      id: 42,
      public_id: METHOD_PUB_A,
      user_id: 1,
      method_type: 'PASSWORD',
      revoked_at: null,
    } as never);
    vi.mocked(authMethodRepository.listByUserId).mockResolvedValue([
      { id: 42, public_id: METHOD_PUB_A, user_id: 1, method_type: 'PASSWORD' },
      { id: 50, public_id: METHOD_PUB_B, user_id: 1, method_type: 'OAUTH' },
    ] as never);

    await expect(service.delete('user_pub', METHOD_PUB_A)).resolves.toBeUndefined();
    // revoke is called with the internal id resolved from findByPublicIdForUser
    expect(authMethodRepository.revoke).toHaveBeenCalledWith(42, user.id);
  });

  it('allows deletion of an MFA method even when it is the only credential — the guard is login-capable-only', async () => {
    // The login-capable guard is intentionally narrow (PASSWORD/OAUTH/MAGIC_LINK).
    // MFA-method deletion goes through MfaService.deleteMfa, which has its own
    // org-policy guard (sec-A4) — this service path stays a thin revoke.
    vi.mocked(authMethodRepository.findByPublicIdForUser).mockResolvedValue({
      id: 42,
      public_id: METHOD_PUB_A,
      user_id: 1,
      method_type: 'MFA_TOTP',
      revoked_at: null,
    } as never);
    vi.mocked(authMethodRepository.listByUserId).mockResolvedValue([
      { id: 42, public_id: METHOD_PUB_A, user_id: 1, method_type: 'MFA_TOTP' },
    ] as never);

    await expect(service.delete('user_pub', METHOD_PUB_A)).resolves.toBeUndefined();
    expect(authMethodRepository.revoke).toHaveBeenCalledWith(42, user.id);
  });

  it('throws NotFoundError when the method does not exist (no count + no revoke)', async () => {
    vi.mocked(authMethodRepository.findByPublicIdForUser).mockResolvedValue(null);

    await expect(service.delete('user_pub', METHOD_PUB_A)).rejects.toBeInstanceOf(NotFoundError);
    expect(authMethodRepository.listByUserId).not.toHaveBeenCalled();
    expect(authMethodRepository.revoke).not.toHaveBeenCalled();
  });
});
