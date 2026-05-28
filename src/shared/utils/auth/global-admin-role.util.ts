import { env } from '@/shared/config/env.config.js';
import { GLOBAL_ROLES, type GlobalRole } from '@/shared/constants/roles.constants.js';

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

/** JWT role for session issuance: global admin override, else user when ACTIVE. */
export function resolveAccessTokenRoleForUser(
  email: string,
  status: string,
): GlobalRole | undefined {
  const globalRole = resolveGlobalRoleForEmail(email);
  if (globalRole) {
    return globalRole;
  }
  return status === 'ACTIVE' ? GLOBAL_ROLES.USER : undefined;
}
