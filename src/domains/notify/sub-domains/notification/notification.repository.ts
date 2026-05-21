import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { resolveRepositoryDatabaseHandle } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import { assertWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database-context.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { notifications } from '@/domains/notify/sub-domains/notification/notification.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { users } from '@/domains/user/user.schema.js';

export interface CreateNotificationInput {
  user_id: number;
  organization_id?: number;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  action_url?: string;
  action_label?: string;
}

export class NotificationRepository {
  constructor(private readonly databaseHandle?: RequestScopedPostgresDatabase) {}

  private db(): RequestScopedPostgresDatabase {
    return resolveRepositoryDatabaseHandle(this.databaseHandle);
  }

  async create(input: CreateNotificationInput): Promise<number> {
    const rows = await this.db()
      .insert(notifications)
      .values({
        public_id: generatePublicId(),
        user_id: input.user_id,
        organization_id: input.organization_id,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data ?? {},
        action_url: input.action_url,
        action_label: input.action_label,
      })
      .returning({ id: notifications.id });
    return rows[0]!.id;
  }

  async findOrganizationPublicIdByNotificationId(notification_id: number): Promise<string | null> {
    const rows = await this.db()
      .select({ organizationPublicId: organizations.public_id })
      .from(notifications)
      .leftJoin(organizations, eq(notifications.organization_id, organizations.id))
      .where(eq(notifications.id, notification_id))
      .limit(1);
    return rows[0]?.organizationPublicId ?? null;
  }

  async findOrganizationPublicIdByOrganizationId(organization_id: number): Promise<string | null> {
    const rows = await this.db()
      .select({ organizationPublicId: organizations.public_id })
      .from(organizations)
      .where(eq(organizations.id, organization_id))
      .limit(1);
    return rows[0]?.organizationPublicId ?? null;
  }

  async findByIdForDispatch(notification_id: number, organization_public_id: string | null) {
    const organizationScopeCondition =
      organization_public_id === null
        ? isNull(notifications.organization_id)
        : eq(organizations.public_id, organization_public_id);

    const rows = await this.db()
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        actionUrl: notifications.action_url,
        data: notifications.data,
        userEmail: users.email,
      })
      .from(notifications)
      .innerJoin(users, eq(notifications.user_id, users.id))
      .leftJoin(organizations, eq(notifications.organization_id, organizations.id))
      .where(and(eq(notifications.id, notification_id), organizationScopeCondition))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByUser(user_id: number, limit: number) {
    return this.db()
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, user_id))
      .orderBy(desc(notifications.created_at))
      .limit(limit);
  }

  async findByPublicIdForUser(public_id: string, user_id: number) {
    const rows = await this.db()
      .select()
      .from(notifications)
      .where(and(eq(notifications.public_id, public_id), eq(notifications.user_id, user_id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async markRead(public_id: string, user_id: number) {
    const rows = await this.db()
      .update(notifications)
      .set({ is_read: true, read_at: new Date() })
      .where(and(eq(notifications.public_id, public_id), eq(notifications.user_id, user_id)))
      .returning();
    return rows[0] ?? null;
  }

  async markAllReadForUser(user_id: number) {
    return this.db()
      .update(notifications)
      .set({ is_read: true, read_at: new Date() })
      .where(and(eq(notifications.user_id, user_id), eq(notifications.is_read, false)))
      .returning();
  }

  async countUnreadForUser(user_id: number): Promise<number> {
    const result = await this.db()
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.user_id, user_id), eq(notifications.is_read, false)));
    return result[0]?.count ?? 0;
  }

  async deleteByPublicIdForUser(public_id: string, user_id: number) {
    const rows = await this.db()
      .delete(notifications)
      .where(and(eq(notifications.public_id, public_id), eq(notifications.user_id, user_id)))
      .returning();
    return rows[0] ?? null;
  }
}

/** Worker-only factory — requires an explicit handle from `withOrganizationContext`. */
export function createWorkerNotificationRepository(
  databaseHandle: RequestScopedPostgresDatabase,
): NotificationRepository {
  assertWorkerDatabaseContext(['organization', 'global_retention_cleanup']);
  return new NotificationRepository(databaseHandle);
}
