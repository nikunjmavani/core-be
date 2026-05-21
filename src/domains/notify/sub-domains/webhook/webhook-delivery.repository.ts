import { and, eq } from 'drizzle-orm';
import {
  getRequestDatabase,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { resolveRepositoryDatabaseHandle } from '@/infrastructure/database/contexts/worker-database-guard.util.js';
import { assertWorkerDatabaseContext } from '@/infrastructure/database/contexts/worker-database-context.js';
import {
  webhook_delivery_attempts,
  webhooks,
} from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

export interface WebhookDeliveryAttemptWithWebhook {
  deliveryAttemptId: number;
  webhookId: number;
  webhookUrl: string;
  encryptedSecret: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

function resolveDatabase(
  databaseHandle?: RequestScopedPostgresDatabase,
): RequestScopedPostgresDatabase {
  return resolveRepositoryDatabaseHandle(databaseHandle);
}

export async function findOrganizationPublicIdByWebhookId(
  webhook_id: number,
  databaseHandle?: RequestScopedPostgresDatabase,
): Promise<string | null> {
  const rows = await resolveDatabase(databaseHandle)
    .select({ organizationPublicId: organizations.public_id })
    .from(webhooks)
    .innerJoin(organizations, eq(webhooks.organization_id, organizations.id))
    .where(eq(webhooks.id, webhook_id))
    .limit(1);
  return rows[0]?.organizationPublicId ?? null;
}

export async function findOrganizationPublicIdByDeliveryAttemptId(
  delivery_attempt_id: number,
  databaseHandle?: RequestScopedPostgresDatabase,
): Promise<string | null> {
  const rows = await resolveDatabase(databaseHandle)
    .select({ organizationPublicId: organizations.public_id })
    .from(webhook_delivery_attempts)
    .innerJoin(webhooks, eq(webhook_delivery_attempts.webhook_id, webhooks.id))
    .innerJoin(organizations, eq(webhooks.organization_id, organizations.id))
    .where(eq(webhook_delivery_attempts.id, delivery_attempt_id))
    .limit(1);
  return rows[0]?.organizationPublicId ?? null;
}

export async function findWebhookDeliveryAttemptWithWebhook(
  deliveryAttemptId: number,
  organization_public_id: string,
  databaseHandle?: RequestScopedPostgresDatabase,
): Promise<WebhookDeliveryAttemptWithWebhook | null> {
  const rows = await resolveDatabase(databaseHandle)
    .select({
      deliveryAttemptId: webhook_delivery_attempts.id,
      webhookId: webhooks.id,
      webhookUrl: webhooks.url,
      encryptedSecret: webhooks.encrypted_secret,
      eventType: webhook_delivery_attempts.event_type,
      payload: webhook_delivery_attempts.payload,
      attemptCount: webhook_delivery_attempts.attempt_count,
    })
    .from(webhook_delivery_attempts)
    .innerJoin(webhooks, eq(webhook_delivery_attempts.webhook_id, webhooks.id))
    .innerJoin(organizations, eq(webhooks.organization_id, organizations.id))
    .where(
      and(
        eq(webhook_delivery_attempts.id, deliveryAttemptId),
        eq(organizations.public_id, organization_public_id),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    deliveryAttemptId: row.deliveryAttemptId,
    webhookId: row.webhookId,
    webhookUrl: row.webhookUrl,
    encryptedSecret: row.encryptedSecret,
    eventType: row.eventType,
    payload: row.payload as Record<string, unknown>,
    attemptCount: row.attemptCount,
  };
}

export async function createPendingWebhookDeliveryAttempt(input: {
  webhookId: number;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  const rows = await getRequestDatabase()
    .insert(webhook_delivery_attempts)
    .values({
      webhook_id: input.webhookId,
      event_type: input.eventType,
      payload: input.payload,
      status: 'PENDING',
      attempt_count: 0,
    })
    .returning({ id: webhook_delivery_attempts.id });
  return rows[0]!.id;
}

/** Worker-only — requires an explicit handle from `withOrganizationContext`. */
export function createWorkerWebhookDeliveryQueries(databaseHandle: RequestScopedPostgresDatabase) {
  assertWorkerDatabaseContext(['organization']);
  return {
    findWebhookDeliveryAttemptWithWebhook: (
      deliveryAttemptId: number,
      organizationPublicId: string,
    ) =>
      findWebhookDeliveryAttemptWithWebhook(
        deliveryAttemptId,
        organizationPublicId,
        databaseHandle,
      ),
  };
}
