/**
 * Notify domain demo seed — in-app notifications and webhooks.
 */
import { and, count, eq } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { encryptFieldSecret } from '@/shared/utils/security/field-secret-encryption.util.js';
import { notifications } from '@/domains/notify/sub-domains/notification/notification.schema.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';

/** Input row for {@link seedNotifications} — one in-app notification to be inserted. */
export interface SeedNotificationPayload {
  user_id: number;
  organization_id: number;
  type: string;
  title: string;
  message: string;
  is_read?: boolean;
}

/** Bulk-insert a batch of demo notifications, auto-stamping `read_at` for read rows. */
export async function seedNotifications(items: SeedNotificationPayload[]) {
  const inserted = [];
  for (const item of items) {
    const isRead = item.is_read ?? false;
    const [row] = await getRequestDatabase()
      .insert(notifications)
      .values({
        public_id: generatePublicId('user'),
        user_id: item.user_id,
        organization_id: item.organization_id,
        type: item.type,
        title: item.title,
        message: item.message,
        is_read: isRead,
        read_at: isRead ? new Date() : null,
      })
      .returning();
    if (row) inserted.push(row);
  }
  return inserted;
}

/**
 * Canonical demo fixtures (4 notifications spanning system, billing, membership, maintenance)
 * used by `pnpm db:seed:full` to populate a realistic inbox.
 */
export const DEMO_NOTIFICATION_FIXTURES: Omit<
  SeedNotificationPayload,
  'user_id' | 'organization_id'
>[] = [
  {
    type: 'system.welcome',
    title: 'Welcome to Demo Organization',
    message: 'Your workspace is ready. Explore billing, notifications, and audit logs.',
    is_read: false,
  },
  {
    type: 'billing.usage_threshold',
    title: 'API usage at 80%',
    message: 'You have used 80% of your monthly API quota.',
    is_read: false,
  },
  {
    type: 'membership.invite_accepted',
    title: 'New member joined',
    message: 'A teammate accepted their invitation.',
    is_read: true,
  },
  {
    type: 'system.maintenance',
    title: 'Scheduled maintenance',
    message: 'Brief maintenance is planned this weekend.',
    is_read: false,
  },
];

/**
 * Idempotent top-up that seeds {@link DEMO_NOTIFICATION_FIXTURES} only when the user/org pair has
 * fewer than `minimumCount` rows — keeps repeated `db:seed:full` runs from duplicating fixtures.
 */
export async function seedDemoNotificationsIfBelowMinimum(
  userId: number,
  organizationId: number,
  minimumCount = 5,
) {
  const database = getRequestDatabase();
  const [row] = await database
    .select({ total: count() })
    .from(notifications)
    .where(
      and(eq(notifications.user_id, userId), eq(notifications.organization_id, organizationId)),
    );

  if ((row?.total ?? 0) >= minimumCount) {
    return [];
  }

  return seedNotifications(
    DEMO_NOTIFICATION_FIXTURES.map((fixture) => ({
      ...fixture,
      user_id: userId,
      organization_id: organizationId,
    })),
  );
}

/** Input shape for {@link seedWebhook} / {@link findOrSeedWebhook}. */
export interface SeedWebhookPayload {
  organization_id: number;
  url: string;
  events: string[];
  created_by_user_id: number;
}

/**
 * Insert a single demo webhook row with an encrypted placeholder secret and `is_enabled = true`.
 * Returns the inserted row, or `null` if the insert produced no row.
 */
export async function seedWebhook(payload: SeedWebhookPayload) {
  const [row] = await getRequestDatabase()
    .insert(webhooks)
    .values({
      public_id: generatePublicId('user'),
      organization_id: payload.organization_id,
      url: payload.url,
      encrypted_secret: encryptFieldSecret('seed-webhook-secret'),
      events: payload.events,
      is_enabled: true,
      created_by_user_id: payload.created_by_user_id,
    })
    .returning();
  return row ?? null;
}

/**
 * Idempotent helper used by `db:seed:full` — returns the existing webhook for
 * `(organization_id, url)` if one exists, otherwise creates it via {@link seedWebhook}.
 */
export async function findOrSeedWebhook(payload: SeedWebhookPayload) {
  const database = getRequestDatabase();
  const [existing] = await database
    .select()
    .from(webhooks)
    .where(
      and(eq(webhooks.organization_id, payload.organization_id), eq(webhooks.url, payload.url)),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const created = await seedWebhook(payload);
  if (!created) throw new Error('findOrSeedWebhook: failed to create webhook');
  return created;
}
