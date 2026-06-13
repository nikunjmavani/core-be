import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { withGlobalAdminDatabaseContext } from '@/infrastructure/database/contexts/global-admin-database.context.js';
import { env } from '@/shared/config/env.config.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';

/**
 * Resolve the default active organization for a user at login: the PERSONAL organization
 * (when `PERSONAL_ORGANIZATION_ENABLED`), otherwise the most-recently-joined active TEAM
 * membership. Returns the organization `public_id`, or `undefined` when the user belongs to
 * no eligible organization (team-only mode, no team yet → the frontend redirects to onboarding).
 *
 * @remarks
 * - **Algorithm:** one indexed join (memberships → organizations) filtered to ACTIVE
 *   membership + non-deleted ACTIVE org, ordered personal-first then most-recent join.
 *   When personal is disabled, PERSONAL organizations are excluded from candidates.
 * - **RLS:** runs under {@link withGlobalAdminDatabaseContext} because login has no
 *   organization context yet (the memberships/organizations policies are keyed on
 *   `app.current_organization_id`). The query is constrained to the authenticated user's
 *   own `user_id`, so the bypass reads only that user's memberships — never cross-user.
 * - **Side effects:** none (read-only).
 */
export async function resolveDefaultActiveOrganizationPublicId(
  userInternalId: number,
): Promise<string | undefined> {
  const personalEnabled = env.PERSONAL_ORGANIZATION_ENABLED;
  return withGlobalAdminDatabaseContext(async (databaseHandle) => {
    const rows = await databaseHandle
      .select({ public_id: organizations.public_id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organization_id))
      .where(
        and(
          eq(memberships.user_id, userInternalId),
          eq(memberships.status, 'ACTIVE'),
          isNull(organizations.deleted_at),
          eq(organizations.status, 'ACTIVE'),
          personalEnabled ? undefined : sql`${organizations.type} <> 'PERSONAL'`,
        ),
      )
      .orderBy(desc(sql`(${organizations.type} = 'PERSONAL')`), desc(memberships.joined_at))
      .limit(1);
    return rows[0]?.public_id;
  });
}

/**
 * Confirm the user holds an ACTIVE membership in the given organization (and the org is
 * active/not-deleted) — the membership gate for `switch-to-organization`. Returns the
 * org `public_id` when valid, otherwise `undefined` (caller maps to 403). Runs under the
 * global-admin RLS context (no org context at switch time) but is constrained to the
 * caller's own `user_id`.
 */
export async function findUserActiveOrganizationPublicId(
  userInternalId: number,
  organizationPublicId: string,
): Promise<string | undefined> {
  return withGlobalAdminDatabaseContext(async (databaseHandle) => {
    const rows = await databaseHandle
      .select({ public_id: organizations.public_id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organization_id))
      .where(
        and(
          eq(memberships.user_id, userInternalId),
          eq(memberships.status, 'ACTIVE'),
          eq(organizations.public_id, organizationPublicId),
          isNull(organizations.deleted_at),
          eq(organizations.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0]?.public_id;
  });
}

/**
 * Resolve the caller's own PERSONAL organization `public_id` — the target for
 * `switch-to-personal` (no body; the server resolves it). Returns `undefined` when the
 * user has no personal organization (e.g. personal disabled), which the caller maps to 409.
 */
export async function resolvePersonalOrganizationPublicId(
  ownerUserInternalId: number,
): Promise<string | undefined> {
  return withGlobalAdminDatabaseContext(async (databaseHandle) => {
    const rows = await databaseHandle
      .select({ public_id: organizations.public_id })
      .from(organizations)
      .where(
        and(
          eq(organizations.owner_user_id, ownerUserInternalId),
          eq(organizations.type, 'PERSONAL'),
          isNull(organizations.deleted_at),
        ),
      )
      .limit(1);
    return rows[0]?.public_id;
  });
}
