import { createHash, randomBytes } from 'node:crypto';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { hashPassword, verifyPassword } from '@/shared/utils/security/password.util.js';
import { eventBus } from '@/core/events/event-bus.js';
import type { UserService } from '@/domains/user/user.service.js';
import {
  AUTH_EVENT,
  type EmailVerificationEmailPayload,
  type PasswordResetEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { AuthMethodCreateData } from './auth-method.types.js';
import type { AuthMethodRepository } from './auth-method.repository.js';
import type { VerificationTokenRepository } from './verification-token/verification-token.repository.js';
import {
  validateCreateAuthMethod,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateVerifyEmail,
} from '../../auth.validator.js';

const PASSWORD_RESET_EXPIRES_IN_MINUTES = 60;
const EMAIL_VERIFICATION_EXPIRES_IN_HOURS = 24;

export class AuthMethodService {
  constructor(
    private readonly userService: UserService,
    private readonly authMethodRepository: AuthMethodRepository,
    private readonly verificationTokenRepository: VerificationTokenRepository,
  ) {}

  async list(userPublicId: string) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    return this.authMethodRepository.listByUserId(user.id);
  }

  async create(userPublicId: string, body: unknown) {
    const parsed = validateCreateAuthMethod(body);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    return this.authMethodRepository.create(
      omitUndefined({
        user_id: user.id,
        method_type: parsed.method_type,
        provider: parsed.provider,
        provider_user_id: parsed.provider_user_id,
        is_primary: parsed.is_primary,
        created_by_user_id: user.id,
      }),
    );
  }

  async delete(userPublicId: string, methodId: number) {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    const revoked = await this.authMethodRepository.revoke(methodId, user.id);
    if (!revoked) throw new NotFoundError('Auth method');
  }

  async revokeAllForUser(userPublicId: string): Promise<void> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    await this.authMethodRepository.revokeAllByUserId(user.id);
  }

  async findByProviderUserId(provider: string, provider_user_id: string) {
    return this.authMethodRepository.findByProviderUserId(provider, provider_user_id);
  }

  async linkOAuthProviderIfMissing(data: AuthMethodCreateData): Promise<void> {
    if (!(data.provider && data.provider_user_id)) {
      return;
    }
    const existing = await this.authMethodRepository.findByProviderUserId(
      data.provider,
      data.provider_user_id,
    );
    if (!existing) {
      await this.authMethodRepository.create(data);
    }
  }

  async findTotpByUserId(user_id: number) {
    return this.authMethodRepository.findTotpByUserId(user_id);
  }

  async createAuthMethodRecord(data: AuthMethodCreateData) {
    return this.authMethodRepository.create(data);
  }

  async updateAuthMethodLastUsedAt(methodId: number, userId: number): Promise<void> {
    await this.authMethodRepository.updateLastUsedAt(methodId, userId);
  }

  async findAuthMethodByIdForUser(methodId: number, userId: number) {
    return this.authMethodRepository.findByIdForUser(methodId, userId);
  }

  async listMfaMethodsByUserId(userId: number) {
    return this.authMethodRepository.listMfaByUserId(userId);
  }

  async revokeAuthMethod(methodId: number, userId: number): Promise<void> {
    const revoked = await this.authMethodRepository.revoke(methodId, userId);
    if (!revoked) throw new NotFoundError('Auth method');
  }

  // ── Password Reset ────────────────────────────────────────────

  async forgotPassword(
    body: unknown,
    _context?: { requestId?: string },
  ): Promise<{ messageKey: string; messageParams?: Record<string, string | number> }> {
    const parsed = validateForgotPassword(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }

    const user = await this.userService.findByEmail(parsed.email);
    if (!user) return { messageKey: 'success:passwordResetEmailSent' };

    // Invalidate any existing password reset tokens
    await this.verificationTokenRepository.invalidateAllForUser(user.id, 'PASSWORD_RESET');

    // Create new token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_IN_MINUTES * 60_000);

    await this.verificationTokenRepository.create(
      'PASSWORD_RESET',
      user.id,
      user.email,
      tokenHash,
      expiresAt,
    );

    await eventBus.emit({
      type: AUTH_EVENT.PASSWORD_RESET_REQUESTED,
      payload: {
        email: user.email,
        reset_token: rawToken,
        expires_in_minutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
      } satisfies PasswordResetEmailPayload,
      timestamp: new Date(),
    });

    return { messageKey: 'success:passwordResetEmailSent' };
  }

  async resetPassword(body: unknown): Promise<void> {
    const parsed = validateResetPassword(body);
    const tokenHash = createHash('sha256').update(parsed.token).digest('hex');

    /** Atomic UPDATE prevents two concurrent resets from both succeeding. */
    const record = await this.verificationTokenRepository.consumeIfValid(tokenHash);
    if (!record || record.token_type !== 'PASSWORD_RESET') {
      throw new UnauthorizedError('errors:invalidOrExpiredResetToken');
    }

    const passwordHash = await hashPassword(parsed.password);

    const user = await this.userService.findById(record.user_id);
    if (!user) throw new NotFoundError('User');

    await this.userService.updatePassword(user.public_id, passwordHash);

    await this.verificationTokenRepository.invalidateAllForUser(user.id, 'PASSWORD_RESET');
  }

  async changePassword(userPublicId: string, body: unknown): Promise<void> {
    const parsed = validateChangePassword(body);
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    if (!user.password_hash) throw new UnauthorizedError('errors:passwordAuthNotEnabled');
    const { valid } = await verifyPassword(parsed.current_password, user.password_hash);
    if (!valid) throw new UnauthorizedError('errors:currentPasswordIncorrect');
    const passwordHash = await hashPassword(parsed.new_password);
    const updatedUser = await this.userService.updatePassword(user.public_id, passwordHash);
    if (!updatedUser) throw new NotFoundError('User');
  }

  // ── Email Verification ────────────────────────────────────────

  async verifyEmail(
    body: unknown,
  ): Promise<{ messageKey: string; messageParams?: Record<string, string | number> }> {
    const parsed = validateVerifyEmail(body);
    const tokenHash = createHash('sha256').update(parsed.token).digest('hex');

    /** Atomic UPDATE prevents two concurrent verifies from both succeeding. */
    const record = await this.verificationTokenRepository.consumeIfValid(tokenHash);
    if (!record || record.token_type !== 'EMAIL_VERIFICATION') {
      throw new UnauthorizedError('errors:invalidOrExpiredVerificationToken');
    }

    const user = await this.userService.findById(record.user_id);
    if (!user) throw new NotFoundError('User');

    await this.userService.updateEmailVerified(user.public_id);

    return { messageKey: 'success:emailVerified' };
  }

  async resendEmailVerification(
    userPublicId: string,
    _context?: { requestId?: string },
  ): Promise<{ messageKey: string; messageParams?: Record<string, string | number> }> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) throw new NotFoundError('User');
    if (user.is_email_verified) {
      return { messageKey: 'success:emailAlreadyVerified' };
    }

    // Invalidate existing verification tokens
    await this.verificationTokenRepository.invalidateAllForUser(user.id, 'EMAIL_VERIFICATION');

    // Create new token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRES_IN_HOURS * 3_600_000);

    await this.verificationTokenRepository.create(
      'EMAIL_VERIFICATION',
      user.id,
      user.email,
      tokenHash,
      expiresAt,
    );

    await eventBus.emit({
      type: AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED,
      payload: {
        email: user.email,
        verification_token: rawToken,
        expires_in_hours: EMAIL_VERIFICATION_EXPIRES_IN_HOURS,
      } satisfies EmailVerificationEmailPayload,
      timestamp: new Date(),
    });

    return { messageKey: 'success:verificationEmailSent' };
  }
}
