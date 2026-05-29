import { env } from '@/shared/config/env.config.js';
import { GLOBAL_ROLES, type GlobalRole } from '@/shared/constants/roles.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

function parseGlobalAdminEmails(): Set<string> {
  const raw = env.GLOBAL_ADMIN_EMAILS;
  if (!raw || raw.trim().length === 0) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

/** Returns super_admin when email is listed in GLOBAL_ADMIN_EMAILS; otherwise undefined. */
export function resolveGlobalRoleForEmail(email: string): GlobalRole | undefined {
  const normalizedEmail = email.trim().toLowerCase();
  if (parseGlobalAdminEmails().has(normalizedEmail)) {
    return GLOBAL_ROLES.SUPER_ADMIN;
  }
  return undefined;
}

/** Inputs for {@link resolveAccessTokenRoleForUser}: the user's email plus the gating account state. */
export interface ResolveAccessTokenRoleInput {
  email: string;
  status: string;
  isEmailVerified: boolean;
}

/**
 * Resolves the JWT global role for session issuance.
 *
 * @remarks
 * The `GLOBAL_ADMIN_EMAILS` allowlist is a break-glass mechanism: a listed email
 * is only elevated to `super_admin` when the account is `ACTIVE` **and** has a
 * verified email, so a misconfigured list or an unverified/suspended account
 * cannot silently obtain platform-wide privileges. Every `super_admin`
 * issuance is logged (`auth.global_admin.super_admin_issued`) for break-glass
 * visibility. Non-admin accounts receive `user` when `ACTIVE`, otherwise no role.
 */
export function resolveAccessTokenRoleForUser({
  email,
  status,
  isEmailVerified,
}: ResolveAccessTokenRoleInput): GlobalRole | undefined {
  const globalRole = resolveGlobalRoleForEmail(email);
  if (globalRole) {
    if (status === 'ACTIVE' && isEmailVerified) {
      logger.warn(
        { email: email.trim().toLowerCase(), role: globalRole },
        'auth.global_admin.super_admin_issued',
      );
      return globalRole;
    }
    logger.warn(
      { email: email.trim().toLowerCase(), status, isEmailVerified },
      'auth.global_admin.super_admin_denied_unverified_or_inactive',
    );
  }
  return status === 'ACTIVE' ? GLOBAL_ROLES.USER : undefined;
}
