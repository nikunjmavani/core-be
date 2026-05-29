import { generateSecret, generateURI, verify } from 'otplib';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { env } from '@/shared/config/env.config.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthMethodService } from '../auth-method/auth-method.service.js';
import type { AuthSessionService } from '../auth-session/auth-session.service.js';
import { MFA_TOTP_CODE_REPLAY_TTL_SECONDS } from '@/shared/constants/index.js';
import {
  validateMfaVerify,
  validateMfaEnroll,
  validateMfaLoginVerify,
} from '../../auth.validator.js';
import { createMfaSession, verifyMfaSession } from './mfa-session.js';
import { consumeMfaRecoveryCode } from './mfa-recovery-code.repository.js';

const TOTP_ISSUER = 'core-be';
const ERROR_KEY_MFA_USER_NOT_FOUND = 'errors:mfaUserNotFound';
const ERROR_KEY_MFA_INVALID_OR_EXPIRED_CODE = 'errors:mfaInvalidOrExpiredCode';

/** Redis key prefix marking a TOTP code consumed by a user, used to reject replay within its validity window. */
const MFA_TOTP_CONSUMED_KEY_PREFIX = 'mfa:totp:consumed:';

/**
 * TOTP-based MFA and recovery-code orchestrator for the auth domain.
 *
 * @remarks
 * - **Algorithm:** enrollment generates an otplib secret, encrypts it via
 *   {@link encryptFieldSecret}, and persists it as an `MFA_TOTP` row in
 *   {@link auth_methods}. Login uses a Redis-backed MFA session
 *   ({@link createMfaSession} / {@link verifyMfaSession}); the verify step accepts
 *   either a TOTP code or a single-use recovery code consumed atomically by
 *   {@link consumeMfaRecoveryCode}.
 * - **Failure modes:** unknown user / wrong code / expired MFA session all throw
 *   `UnauthorizedError` with i18n keys (`errors:mfaInvalidOrExpiredCode`,
 *   `errors:mfaInvalidOrExpiredSession`, `errors:mfaUserNotFound`,
 *   `errors:mfaInvalidOrExpiredRecoveryCode`).
 * - **Side effects:** writes to {@link auth_methods}, {@link mfa_recovery_codes},
 *   and `auth.sessions`; flips `users.is_mfa_enabled` on enroll and on the last
 *   method removal; refreshes `auth_methods.last_used_at` on every successful
 *   verification; records each consumed TOTP code in Redis for
 *   {@link MFA_TOTP_CODE_REPLAY_TTL_SECONDS} to reject replay.
 * - **Notes:** secrets are encrypted at rest using the field-secret KMS path;
 *   recovery codes are stored only as SHA-256 hashes and consumed exactly once
 *   via an atomic `UPDATE … WHERE used_at IS NULL`. The public login step is
 *   reachable only with a valid `mfa_session_token` minted by `auth.login`
 *   after first-factor (password) verification — there is no TOTP-only login.
 */
export class MfaService {
  constructor(
    private readonly userService: UserService,
    private readonly authMethodService: AuthMethodService,
    private readonly authSessionService: AuthSessionService,
    private readonly redis: Redis,
  ) {}

  async createMfaSession(userPublicId: string): Promise<string> {
    return createMfaSession(this.redis, userPublicId);
  }

  async verifyMfaSession(mfaSessionToken: string): Promise<{ user_public_id: string }> {
    return verifyMfaSession(this.redis, mfaSessionToken);
  }

  /** Public login step: verify TOTP or recovery code, then issue JWT + session. */
  async verifyLoginMfa(
    body: unknown,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{ access_token: string; session_public_id: string }> {
    const parsed = validateMfaLoginVerify(body);
    const session = await verifyMfaSession(this.redis, parsed.mfa_session_token);
    const user = await this.userService.requireUserRecordByPublicId(session.user_public_id);
    if (!user) {
      throw new UnauthorizedError(ERROR_KEY_MFA_USER_NOT_FOUND);
    }

    let verified = false;
    if (parsed.totp_code) {
      const totpMethod = await this.authMethodService.findTotpByUserId(user.id);
      if (!totpMethod?.encrypted_secret) {
        throw new UnauthorizedError('errors:mfaNotEnabled');
      }
      const result = await verify({
        secret: decryptFieldSecret(totpMethod.encrypted_secret),
        token: parsed.totp_code,
      });
      if (!result.valid) {
        throw new UnauthorizedError(ERROR_KEY_MFA_INVALID_OR_EXPIRED_CODE);
      }
      await this.rejectReplayedTotpCode(user.id, parsed.totp_code);
      await this.authMethodService.updateAuthMethodLastUsedAt(totpMethod.id, user.id);
      verified = true;
    } else if (parsed.recovery_code) {
      const consumed = await consumeMfaRecoveryCode(user.id, parsed.recovery_code);
      if (!consumed) {
        throw new UnauthorizedError('errors:mfaInvalidOrExpiredRecoveryCode');
      }
      verified = true;
    }

    if (!verified) {
      throw new UnauthorizedError(ERROR_KEY_MFA_INVALID_OR_EXPIRED_CODE);
    }

    return this.issueAccessTokenAndSession(user, ipAddress, userAgent);
  }

  /**
   * Marks a freshly-verified TOTP code as consumed in Redis and rejects it if it
   * was already used. `SET NX` makes the check-and-set atomic so two concurrent
   * requests carrying the same valid code cannot both succeed; a replay surfaces
   * as the generic invalid-code error to avoid leaking that the code was valid.
   */
  private async rejectReplayedTotpCode(userId: number, totpCode: string): Promise<void> {
    const codeHash = createHash('sha256').update(totpCode).digest('hex');
    const key = `${MFA_TOTP_CONSUMED_KEY_PREFIX}${userId}:${codeHash}`;
    const stored = await this.redis.set(key, '1', 'EX', MFA_TOTP_CODE_REPLAY_TTL_SECONDS, 'NX');
    if (stored === null) {
      throw new UnauthorizedError(ERROR_KEY_MFA_INVALID_OR_EXPIRED_CODE);
    }
  }

  private async issueAccessTokenAndSession(
    user: { public_id: string; email: string; status: string; is_email_verified: boolean },
    ipAddress: string,
    userAgent?: string,
  ): Promise<{ access_token: string; session_public_id: string }> {
    const jsonWebToken = await signAccessToken({
      userId: user.public_id,
      role: resolveAccessTokenRoleForUser({
        email: user.email,
        status: user.status,
        isEmailVerified: user.is_email_verified,
      }),
    });
    const tokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
    const sessionMaxAgeDays = env.AUTH_SESSION_MAX_AGE_DAYS;
    const expiresAt = new Date(Date.now() + sessionMaxAgeDays * 86_400_000);
    const authSession = await this.authSessionService.createSessionForUser(
      user.public_id,
      omitUndefined({
        token_hash: tokenHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
      }),
    );
    return { access_token: jsonWebToken, session_public_id: authSession.public_id };
  }

  /** Verify TOTP code for the current user. Requires authenticated request (user public_id). */
  async verify(userPublicId: string, body: unknown): Promise<{ verified: boolean }> {
    const parsed = validateMfaVerify(body);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new UnauthorizedError(ERROR_KEY_MFA_USER_NOT_FOUND);
    const totpMethod = await this.authMethodService.findTotpByUserId(user.id);
    if (!totpMethod?.encrypted_secret) {
      throw new UnauthorizedError('errors:mfaNotEnabled');
    }
    const result = await verify({
      secret: decryptFieldSecret(totpMethod.encrypted_secret),
      token: parsed.code,
    });
    if (!result.valid) {
      throw new UnauthorizedError(ERROR_KEY_MFA_INVALID_OR_EXPIRED_CODE);
    }
    await this.rejectReplayedTotpCode(user.id, parsed.code);
    await this.authMethodService.updateAuthMethodLastUsedAt(totpMethod.id, user.id);
    return { verified: true };
  }

  /** Enroll MFA (TOTP) for the current user. Returns secret and provisioning URI. */
  async enroll(
    userPublicId: string,
    body: unknown,
  ): Promise<{ secret: string; provisioning_uri: string; method_id: number }> {
    const parsed = validateMfaEnroll(body);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new UnauthorizedError(ERROR_KEY_MFA_USER_NOT_FOUND);
    if (parsed.method_type !== 'MFA_TOTP') {
      throw new UnauthorizedError('errors:mfaOnlyTotpSupported');
    }
    const secret = generateSecret();
    const provisioningUri = generateURI({
      issuer: TOTP_ISSUER,
      label: user.email,
      secret,
    });
    const record = await this.authMethodService.createAuthMethodRecord({
      user_id: user.id,
      method_type: 'MFA_TOTP',
      encrypted_secret: encryptFieldSecret(secret),
      is_primary: false,
      created_by_user_id: user.id,
    });
    await this.userService.updateMfaEnabled(user.public_id, true);
    return {
      secret,
      provisioning_uri: provisioningUri,
      method_id: record.id,
    };
  }

  /** Delete (revoke) an MFA method for the current user. */
  async deleteMfa(userPublicId: string, mfaMethodId: number): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new UnauthorizedError(ERROR_KEY_MFA_USER_NOT_FOUND);
    const method = await this.authMethodService.findAuthMethodByIdForUser(mfaMethodId, user.id);
    if (!method) throw new UnauthorizedError('errors:mfaMethodNotFound');
    if (method.method_type !== 'MFA_TOTP') {
      throw new UnauthorizedError('errors:mfaNotTotpMethod');
    }
    await this.authMethodService.revokeAuthMethod(mfaMethodId, user.id);
    const remaining = await this.authMethodService.listMfaMethodsByUserId(user.id);
    if (remaining.length === 0) {
      await this.userService.updateMfaEnabled(user.public_id, false);
    }
  }

  /** List MFA methods for the current user. */
  async listMfaMethods(userPublicId: string) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new UnauthorizedError(ERROR_KEY_MFA_USER_NOT_FOUND);
    const methods = await this.authMethodService.listMfaMethodsByUserId(user.id);
    return methods.map((method) => ({
      id: method.id,
      method_type: method.method_type,
      last_used_at: method.last_used_at,
      created_at: method.created_at,
    }));
  }
}
