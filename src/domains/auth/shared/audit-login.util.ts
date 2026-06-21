import type { FastifyRequest } from 'fastify';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { GLOBAL_ROLES } from '@/shared/constants/roles.constants.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';

/**
 * Discriminator for the originating login surface. Used as the `source`
 * metadata field on `auth.login` audit events so an incident-response query
 * can filter by method (e.g. "every super_admin login via OAuth in the last
 * 24 h"). Provider-bound sources (OAuth) embed the provider id —
 * `oauth_google`, `oauth_github` — to preserve that information without
 * adding a separate column.
 */
export type LoginAuditSource = 'password' | 'magic_link' | 'webauthn' | `oauth_${string}`;

/**
 * Subset of the first-factor auth result that carries enough to identify the
 * session and the access token. The helper extracts the actor user public id
 * from the JWT, so a freshly minted token must be present.
 */
export interface LoginAuditEventInput {
  access_token: string;
  session_public_id: string;
}

/**
 * Records the audit row(s) for a successful login (sec-A8).
 *
 * @remarks
 * auth.overview.md promises "every login (success or failure) records a row". Before
 * this helper the promise held only for password login — OAuth, magic-link,
 * and WebAuthn callbacks succeeded silently. Brute-force / credential-stuffing
 * detection requires a single source of truth for `auth.login` events; this
 * helper centralizes the row plus the high-severity `auth.super_admin.token_issued`
 * shadow event so every entrypoint emits both with a consistent `source`
 * discriminator.
 *
 * Failure modes are swallowed (logged at `warn`): an audit-pipeline outage or
 * a malformed JWT must NEVER break the user-visible login response. The
 * `await` is intentional so the caller can guarantee best-effort recording
 * completes before the handler returns its response.
 */
export async function recordLoginAuditEvent(
  request: FastifyRequest,
  loginResult: LoginAuditEventInput,
  source: LoginAuditSource,
): Promise<void> {
  try {
    const payload = await verifyAccessToken(loginResult.access_token);
    await recordScopedAuditEvent(request, {
      actorUserPublicId: payload.userId,
      action: 'auth.login',
      resource_type: 'session',
      metadata: {
        session_public_id: loginResult.session_public_id,
        source,
      },
    });
    if (payload.role === GLOBAL_ROLES.SUPER_ADMIN) {
      // Break-glass visibility: every platform super_admin token issuance is a
      // high-severity event regardless of the login surface that minted it.
      await recordScopedAuditEvent(request, {
        actorUserPublicId: payload.userId,
        action: 'auth.super_admin.token_issued',
        resource_type: 'session',
        severity: 'WARNING',
        metadata: {
          session_public_id: loginResult.session_public_id,
          source,
        },
      });
    }
  } catch (error) {
    logger.warn({ error }, 'audit.login.recording.failed');
  }
}

/**
 * Derives the audit `error_code` from a thrown value: the i18n `messageKey` of a typed
 * `AppError` when present, else the error `name`, else `'unknown'`. Kept as a flat helper
 * so the failure-audit path has no nested ternary.
 */
function extractLoginFailureErrorCode(error: unknown): unknown {
  if (error !== null && typeof error === 'object') {
    if ('messageKey' in error) return (error as { messageKey?: unknown }).messageKey;
    if ('name' in error) return (error as { name?: unknown }).name;
  }
  return 'unknown';
}

/**
 * Records a `auth.login_failure` event on the symmetric failure side of every
 * login surface (sec-A8 follow-up).
 *
 * @remarks
 * auth.overview.md promises "every login (success or failure) records a row".
 * {@link recordLoginAuditEvent} covered success; this helper closes the
 * failure side so a brute-force / credential-stuffing attempt is visible
 * in `audit.events` as `auth.login_failure` with the originating `source`
 * and an `error_code` that maps to the thrown class (e.g.
 * `invalid_email_or_password`, `mfa_required`, `account_locked`).
 *
 * No `actorUserPublicId` is recorded — we deliberately do NOT know who they
 * tried to log in as. The IP / user-agent captured by
 * {@link recordScopedAuditEvent}'s network helper is enough for "failed
 * logins from this IP in the last hour" detection without leaking which
 * accounts the attacker enumerated.
 *
 * Best-effort. A failure to write the audit row must NEVER break the
 * downstream re-throw — callers always `await recordLoginFailureAuditEvent`
 * and then rethrow the original error.
 */
export async function recordLoginFailureAuditEvent(
  request: FastifyRequest,
  source: LoginAuditSource,
  error: unknown,
): Promise<void> {
  try {
    // Capture the i18n message key (when present on a typed AppError) as the
    // error_code so audit rows are consistent across calls — far more useful
    // than the raw stringified message which carries the user's locale.
    const errorCode = extractLoginFailureErrorCode(error);
    await recordScopedAuditEvent(request, {
      action: 'auth.login_failure',
      resource_type: 'session',
      severity: 'INFO',
      metadata: {
        source,
        error_code: typeof errorCode === 'string' ? errorCode : 'unknown',
      },
    });
  } catch (recordingError) {
    logger.warn({ error: recordingError }, 'audit.login_failure.recording.failed');
  }
}
