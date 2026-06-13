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
