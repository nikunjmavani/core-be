import { and, eq, isNull } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { organization_settings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.schema.js';

export type OrganizationDefaultLocale = 'en' | 'es';

export class OrganizationSettingsRepository {
  /**
   * Login-time / middleware locale (no tenant HTTP context): resolve org default BCP 47 tag.
   */
  async findDefaultLocaleByOrganizationPublicId(
    organizationPublicId: string,
  ): Promise<OrganizationDefaultLocale | null> {
    const rows = await database
      .select({ default_locale: organization_settings.default_locale })
      .from(organization_settings)
      .innerJoin(organizations, eq(organization_settings.organization_id, organizations.id))
      .where(eq(organizations.public_id, organizationPublicId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return row.default_locale === 'es' ? 'es' : 'en';
  }

  async findByOrganizationId(organization_id: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(organization_settings)
      .where(eq(organization_settings.organization_id, organization_id))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(
    organization_id: number,
    data: {
      is_email_notifications_enabled?: boolean;
      default_locale?: OrganizationDefaultLocale;
      security_policy?: object;
      updated_by_user_id?: number | null;
    },
  ) {
    const row = {
      organization_id,
      is_email_notifications_enabled: data.is_email_notifications_enabled ?? true,
      default_locale: data.default_locale ?? 'en',
      security_policy: data.security_policy ?? {},
      updated_by_user_id: data.updated_by_user_id ?? undefined,
    };
    const rows = await getRequestDatabase()
      .insert(organization_settings)
      .values(row)
      .onConflictDoUpdate({
        target: organization_settings.organization_id,
        set: {
          ...(data.is_email_notifications_enabled !== undefined && {
            is_email_notifications_enabled: data.is_email_notifications_enabled,
          }),
          ...(data.security_policy !== undefined && { security_policy: data.security_policy }),
          ...(data.default_locale !== undefined && { default_locale: data.default_locale }),
          updated_at: databaseNowTimestamp,
          updated_by_user_id: data.updated_by_user_id ?? undefined,
        },
      })
      .returning();
    return rows[0]!;
  }

  /**
   * Login-time check (no tenant HTTP context): true when the user belongs to an active
   * membership in an organization whose security_policy requires MFA.
   */
  async userHasOrganizationRequiringMfa(userId: number): Promise<boolean> {
    const rows = await database
      .select({ security_policy: organization_settings.security_policy })
      .from(memberships)
      .innerJoin(
        organization_settings,
        eq(memberships.organization_id, organization_settings.organization_id),
      )
      .where(
        and(
          eq(memberships.user_id, userId),
          eq(memberships.status, 'ACTIVE'),
          isNull(memberships.deleted_at),
        ),
      );

    return rows.some((row) => {
      const securityPolicy = row.security_policy as Record<string, unknown>;
      return securityPolicy.mfa_required === true;
    });
  }
}
