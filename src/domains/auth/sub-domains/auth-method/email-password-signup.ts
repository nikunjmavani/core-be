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
 * - **Algorithm:** normalize the email; reject disposable domains; resolve any existing account and
 *   either `409` (a real account: has a password, a login-capable auth method, or a verified email) or
 *   CLAIM it (a pre-provisioned, credential-less invited account from add-member-by-email — so the
 *   invitee is not dead-ended at a 409); hash the password OUTSIDE the transaction (argon2 is
 *   CPU-bound); then (1) in one `withTransaction` pinned via {@link runWithPinnedDatabaseHandle},
 *   atomically insert-or-claim the user (`is_email_verified=false`) + link the `PASSWORD` auth-method;
 *   (2) AFTER that commits, best-effort provision the personal organization (when
 *   `PERSONAL_ORGANIZATION_ENABLED`); (3) call {@link completeFirstFactorAuth} to issue the session so
 *   the token carries the personal-org claim.
 * - **Failure modes:** disposable email → `ValidationError`; a real existing account (pre-check or the
 *   race-proof unique-index / guarded-claim miss) → `ConflictError('errors:emailAlreadyRegistered')`.
 *   A new/claimed user never has MFA, so the result is the access-token arm of
 *   {@link FirstFactorAuthResult} in practice. The claimed account stays unverified (a verification
 *   code is emailed) and invitation-accept independently requires a verified email, so a claim alone
 *   grants no email-control-gated capability.
 * - **Side effects:** atomically inserts a user + a `PASSWORD` auth-method; then (post-commit)
 *   best-effort inserts the personal organization via a separate global-admin connection — which is
 *   exactly why it runs after the commit, since that connection cannot see an uncommitted user — and
 *   creates a session row. The caller sets the session cookie and triggers the verification email.
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

  // An already-registered email is a 409 (the chosen signup UX, unlike the anti-enumeration silence
  // of login / forgot-password / magic-link) — EXCEPT a pre-provisioned, credential-less invited
  // account (created by add-member-by-email so its INVITED membership has a user_id). That bare row
  // is "claimed" by this signup instead of dead-ending the invitee at a 409. A real account (one with
  // a password, a login-capable auth method, or a verified email) still returns 409.
  const existing = await userService.findByEmail(normalizedEmail);
  if (existing) {
    // A "real" account has a usable credential (password or a login-capable auth method) or a verified
    // email — it stays a 409. A pre-provisioned invited account has none of these, so it is claimed
    // (its first password is set) in the transaction below instead of dead-ending the invitee.
    const hasRealCredential =
      Boolean(existing.password_hash) ||
      existing.is_email_verified ||
      (await authMethodService.hasLoginCapableMethod(existing.public_id));
    if (hasRealCredential) {
      throw new ConflictError('errors:emailAlreadyRegistered');
    }
  }

  // Hash BEFORE opening the transaction: argon2 is CPU-bound (~100ms) and must not hold a pooled
  // connection open inside the transaction.
  const passwordHash = await hashPassword(parameters.password);

  // Atomic: the user row (created or claimed) and its PASSWORD auth-method commit together (a failed
  // method insert rolls the user back rather than leaving a password-less orphan).
  const user = await withTransaction((transaction) =>
    runWithPinnedDatabaseHandle(transaction as RequestScopedPostgresDatabase, async () => {
      if (existing) {
        // Claim the pre-provisioned invited account: set its first password + link the PASSWORD
        // method. The guarded UPDATE returns null if a concurrent claim already set a password.
        const claimed = await userService.claimWithPassword(existing.public_id, {
          passwordHash,
          firstName: parameters.firstName,
          lastName: parameters.lastName,
        });
        if (!claimed) throw new ConflictError('errors:emailAlreadyRegistered');
        await authMethodService.createPasswordMethod(claimed.id, claimed.public_id);
        return claimed;
      }
      let created: UserAuthRecord;
      try {
        created = await userService.createWithPassword(
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
      await authMethodService.createPasswordMethod(created.id, created.public_id);
      return created;
    }),
  );

  // Personal organization, mirroring OAuth signup — provisioned AFTER the user commits. It runs in a
  // SEPARATE global-admin transaction (its own pool connection) which cannot see an uncommitted user,
  // so doing it inside the transaction above would always FK-fail; post-commit it succeeds. Still
  // best-effort: a failure must not fail signup (the partial unique index makes a retry idempotent
  // and tool:backfill-personal-orgs recovers a miss). Skipped in team-only mode.
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

  // Mint the session AFTER provisioning so the access token carries the personal-org claim. Like
  // login, completeFirstFactorAuth runs on the request handle (no pinned transaction needed).
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
}
