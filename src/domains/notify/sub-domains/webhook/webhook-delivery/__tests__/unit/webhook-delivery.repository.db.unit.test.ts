import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { webhook_delivery_attempts } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';
import {
  createPendingWebhookDeliveryAttempt,
  findOrganizationPublicIdByDeliveryAttemptId,
  findOrganizationPublicIdByWebhookId,
  findWebhookDeliveryAttemptWithWebhook,
  markDeliveryAttemptEnqueueFailed,
} from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.repository.js';

describe('webhook-delivery.repository (database)', () => {
  const webhookRepository = new WebhookRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('resolves organization by webhook and delivery attempt ids', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const webhook = await webhookRepository.create({
      organization_id: organization.id,
      url: 'https://example.com/webhooks',
      events: ['subscription.updated'],
      encrypted_secret: 'sample-webhook-secret-primary',
      created_by_user_id: owner.id,
    });

    const organizationByWebhook = await findOrganizationPublicIdByWebhookId(webhook.id);
    expect(organizationByWebhook).toBe(organization.public_id);

    const deliveryAttemptId = await createPendingWebhookDeliveryAttempt({
      webhookId: webhook.id,
      eventType: 'subscription.updated',
      payload: { subscription_id: 'sub_1' },
    });
    expect(deliveryAttemptId).not.toBeNull();

    const organizationByAttempt = await findOrganizationPublicIdByDeliveryAttemptId(
      deliveryAttemptId!,
    );
    expect(organizationByAttempt).toBe(organization.public_id);

    const delivery = await findWebhookDeliveryAttemptWithWebhook(
      deliveryAttemptId!,
      organization.public_id,
    );
    expect(delivery?.webhookUrl).toBe('https://example.com/webhooks');
    expect(delivery?.eventType).toBe('subscription.updated');
    expect(delivery?.payload).toEqual({ subscription_id: 'sub_1' });
  });

  it('findWebhookDeliveryAttemptWithWebhook returns null for wrong organization', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const webhook = await webhookRepository.create({
      organization_id: organization.id,
      url: 'https://example.com/other',
      events: ['subscription.updated'],
      encrypted_secret: 'sample-webhook-secret-secondary',
      created_by_user_id: owner.id,
    });

    const deliveryAttemptId = await createPendingWebhookDeliveryAttempt({
      webhookId: webhook.id,
      eventType: 'subscription.updated',
      payload: {},
    });
    expect(deliveryAttemptId).not.toBeNull();

    const missing = await findWebhookDeliveryAttemptWithWebhook(
      deliveryAttemptId!,
      'org_does_not_match',
    );
    expect(missing).toBeNull();
  });

  it('findOrganizationPublicIdByWebhookId returns null when webhook missing', async () => {
    const result = await findOrganizationPublicIdByWebhookId(999_999);
    expect(result).toBeNull();
  });

  it('findOrganizationPublicIdByDeliveryAttemptId returns null when attempt missing', async () => {
    const result = await findOrganizationPublicIdByDeliveryAttemptId(999_999);
    expect(result).toBeNull();
  });

  // The only backstop against a delivery row stuck in PENDING forever when the post-commit BullMQ
  // enqueue fails (a Redis blip). Referenced only in source until now — no test proved the SQL.
  it('markDeliveryAttemptEnqueueFailed moves a stuck PENDING row to FAILED / enqueue_failed with no retry', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const webhook = await webhookRepository.create({
      organization_id: organization.id,
      url: 'https://example.com/enqueue-fail',
      events: ['subscription.updated'],
      encrypted_secret: 'sample-webhook-secret-enqueuefail',
      created_by_user_id: owner.id,
    });
    const deliveryAttemptId = await createPendingWebhookDeliveryAttempt({
      webhookId: webhook.id,
      eventType: 'subscription.updated',
      payload: { subscription_id: 'sub_enqueue_fail' },
    });
    expect(deliveryAttemptId).not.toBeNull();

    await markDeliveryAttemptEnqueueFailed(deliveryAttemptId!);

    const [row] = await database
      .select()
      .from(webhook_delivery_attempts)
      .where(eq(webhook_delivery_attempts.id, deliveryAttemptId!));
    expect(row?.status).toBe('FAILED');
    expect(row?.response_body).toBe('enqueue_failed');
    expect(row?.http_status_code).toBeNull();
    // next_retry_at null so the retention/retry paths never re-pick a terminally-enqueue-failed row.
    expect(row?.next_retry_at).toBeNull();
  });
});
