import { and, asc, eq, isNull } from 'drizzle-orm';
import { databaseNowTimestamp } from '@/shared/utils/infrastructure/database-timestamp.util.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { organization_notification_policies } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.schema.js';
import type { OrganizationNotificationPolicyRow } from './organization-notification-policy.types.js';

/**
 * Drizzle data-access for `tenancy.organization_notification_policies`.
 * Supports per-org list (ordered by `notification_type` then `channel`),
 * primary-key lookup scoped to the organization, soft-delete-aware upsert
 * keyed on `(organization_id, notification_type, channel)`, partial update,
 * and soft-delete.
 */
export class OrganizationNotificationPolicyRepository {
  async findByOrganizationId(organization_id: number) {
    const rows = await getRequestDatabase()
      .select()
      .from(organization_notification_policies)
      .where(
        and(
          eq(organization_notification_policies.organization_id, organization_id),
          isNull(organization_notification_policies.deleted_at),
        ),
      )
      .orderBy(
        asc(organization_notification_policies.notification_type),
        asc(organization_notification_policies.channel),
      );
    return rows as OrganizationNotificationPolicyRow[];
  }

  async findById(
    id: number,
    organization_id: number,
  ): Promise<OrganizationNotificationPolicyRow | null> {
    const rows = await getRequestDatabase()
      .select()
      .from(organization_notification_policies)
      .where(
        and(
          eq(organization_notification_policies.id, id),
          eq(organization_notification_policies.organization_id, organization_id),
          isNull(organization_notification_policies.deleted_at),
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as OrganizationNotificationPolicyRow | null;
  }

  async create(data: {
    organization_id: number;
    notification_type: string;
    channel: string;
    default_enabled?: boolean;
    is_mandatory?: boolean;
    muted_until?: Date | null;
    created_by_user_id?: number | null;
  }) {
    const mutableCreatedBy = data.created_by_user_id ?? undefined;
    const rows = await getRequestDatabase()
      .insert(organization_notification_policies)
      .values({
        public_id: generatePublicId(),
        organization_id: data.organization_id,
        notification_type: data.notification_type,
        channel: data.channel,
        default_enabled: data.default_enabled ?? true,
        is_mandatory: data.is_mandatory ?? false,
        muted_until: data.muted_until ?? undefined,
        ...(mutableCreatedBy !== undefined && {
          created_by_user_id: mutableCreatedBy,
          updated_by_user_id: mutableCreatedBy,
        }),
      })
      .onConflictDoUpdate({
        target: [
          organization_notification_policies.organization_id,
          organization_notification_policies.notification_type,
          organization_notification_policies.channel,
        ],
        set: {
          deleted_at: null,
          default_enabled: data.default_enabled ?? true,
          is_mandatory: data.is_mandatory ?? false,
          muted_until: data.muted_until ?? undefined,
          updated_at: databaseNowTimestamp,
          updated_by_user_id: mutableCreatedBy,
        },
      })
      .returning();
    return rows[0]! as OrganizationNotificationPolicyRow;
  }

  async update(
    id: number,
    organization_id: number,
    data: {
      default_enabled?: boolean;
      is_mandatory?: boolean;
      muted_until?: Date | null;
    },
    updated_by_user_id: number | null,
  ): Promise<OrganizationNotificationPolicyRow | null> {
    const rows = await getRequestDatabase()
      .update(organization_notification_policies)
      .set({
        ...data,
        updated_at: databaseNowTimestamp,
        updated_by_user_id: updated_by_user_id ?? undefined,
      })
      .where(
        and(
          eq(organization_notification_policies.id, id),
          eq(organization_notification_policies.organization_id, organization_id),
          isNull(organization_notification_policies.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as OrganizationNotificationPolicyRow | null;
  }

  async softDelete(
    id: number,
    organization_id: number,
  ): Promise<OrganizationNotificationPolicyRow | null> {
    const rows = await getRequestDatabase()
      .update(organization_notification_policies)
      .set({ deleted_at: databaseNowTimestamp, updated_at: databaseNowTimestamp })
      .where(
        and(
          eq(organization_notification_policies.id, id),
          eq(organization_notification_policies.organization_id, organization_id),
          isNull(organization_notification_policies.deleted_at),
        ),
      )
      .returning();
    return (rows[0] ?? null) as OrganizationNotificationPolicyRow | null;
  }
}
