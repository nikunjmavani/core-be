import { ConflictError, ValidationError } from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { hashPassword } from '@/shared/utils/security/password.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { env } from '@/shared/config/env.config.js';
import { withTransaction } from '@/infrastructure/database/transaction.js';
import {
  runWithPinnedDatabaseHandle,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { provisionPersonalOrganization } from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { UserAuthRecord } from '@/domains/user/user.types.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import {
  completeFirstFactorAuth,
  type FirstFactorAuthResult,
} from '@/domains/auth/shared/complete-first-factor-auth.js';

/** True when `error` is a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * Final stage of `POST /auth/signup`: creates an email/password user, links the `PASSWORD`
 * auth-method, provisions the personal organization, and mints an access token + session so the
 * caller is logged in immediately — all in one pinned transaction (mirrors {@link completeOAuthUserSession}).
 *
 * @remarks
 * - **Algorithm:** normalize the email; reject disposable domains; fast-path `409` when the email
 *   already has an account (the chosen signup UX, unlike the anti-enumeration silence of
 *   login/forgot/magic-link); hash the password OUTSIDE the transaction (argon2 is CPU-bound); then,
 *   in one `withTransaction` pinned via {@link runWithPinnedDatabaseHandle}: insert the user
 *   (`is_email_verified=false`), insert the `PASSWORD` auth-method, best-effort provision the personal
 *   organization (when `PERSONAL_ORGANIZATION_ENABLED`), and call {@link completeFirstFactorAuth} to
 *   issue the session.
 * - **Failure modes:** disposable email → `ValidationError`; existing email (pre-check or the
 *   race-proof unique-index violation) → `ConflictError('errors:emailAlreadyRegistered')`. A new user
 *   never has MFA, so the result is the access-token arm of {@link FirstFactorAuthResult} in practice.
 * - **Side effects:** inserts a user + a `PASSWORD` auth-method (atomic), best-effort inserts the
 *   personal organization on a separate admin connection, and creates a session row. The caller is
 *   responsible for setting the session cookie and triggering the verification email afterward.
 * - **Notes:** the personal-org provision is best-effort (the partial unique index makes a retry
 *   idempotent; `tool:backfill-personal-orgs` recovers a miss), matching OAuth signup.
 */
export async function completeEmailPasswordSignup(parameters: {
  userService: UserService;
  authMethodService: AuthMethodService;
  authSessionService: AuthSessionService;
  organizationSettingsService: OrganizationSettingsService;
  mfaService: MfaService;
  email: string;
  password: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  ipAddress: string;
  userAgent?: string | undefined;
}): Promise<FirstFactorAuthResult & { user: UserAuthRecord }> {
  const {
    userService,
    authMethodService,
    authSessionService,
    organizationSettingsService,
    mfaService,
  } = parameters;
  const normalizedEmail = parameters.email.trim().toLowerCase();

  if (isDisposableEmailBlocked(normalizedEmail)) {
    throw new ValidationError('errors:disposableEmail', undefined, undefined, [
      { field: 'email', messageKey: 'errors:disposableEmail' },
    ]);
  }

  // Explicit 409 on an already-registered email (the chosen signup UX, in contrast to the
  // anti-enumeration silence of login / forgot-password / magic-link). The DB unique index is the
  // race-proof source of truth (mapped below); this pre-check just avoids a wasted argon2 hash.
  if (await userService.findByEmail(normalizedEmail)) {
    throw new ConflictError('errors:emailAlreadyRegistered');
  }

  // Hash BEFORE opening the transaction: argon2 is CPU-bound (~100ms) and must not hold a pooled
  // connection open inside the transaction.
  const passwordHash = await hashPassword(parameters.password);

  return withTransaction((transaction) =>
    runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
      let user: UserAuthRecord;
      try {
        user = await userService.createWithPassword(
          omitUndefined({
            email: normalizedEmail,
            password_hash: passwordHash,
            first_name: parameters.firstName,
            last_name: parameters.lastName,
          }),
        );
      } catch (error) {
        // A concurrent signup with the same email lost the race on the unique email index.
        if (isUniqueViolation(error)) throw new ConflictError('errors:emailAlreadyRegistered');
        throw error;
      }

      // PASSWORD auth_method row in the SAME pinned transaction so it commits atomically with the
      // user (a failed insert rolls the user back instead of leaving a password-less orphan).
      await authMethodService.createPasswordMethod(user.id, user.public_id);

      // Account-level personal organization, mirroring OAuth signup. Best-effort: a provisioning
      // failure must not fail signup; the partial unique index makes a retry idempotent and the
      // tool:backfill-personal-orgs script recovers it. Skipped in team-only mode.
      if (env.PERSONAL_ORGANIZATION_ENABLED) {
        try {
          await provisionPersonalOrganization(user.id);
        } catch (error) {
          logger.error(
            { err: error, userId: user.public_id },
            'signup.user.personal_org_provision_failed',
          );
        }
      }

      const authResult = await completeFirstFactorAuth({
        user: {
          id: user.id,
          public_id: user.public_id,
          email: user.email,
          status: user.status,
          is_email_verified: user.is_email_verified,
          is_mfa_enabled: user.is_mfa_enabled,
        },
        ipAddress: parameters.ipAddress,
        userAgent: parameters.userAgent,
        organizationSettingsService,
        mfaService,
        authSessionService,
      });
      return { ...authResult, user };
    }),
  );
}
