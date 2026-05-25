import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';
import { WebhookDeliveryAttemptRepository } from '@/domains/notify/sub-domains/webhook/webhook-delivery-attempt.repository.js';

describe('WebhookDeliveryAttemptRepository (database)', () => {
  const webhookRepository = new WebhookRepository();
  const attemptRepository = new WebhookDeliveryAttemptRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates and lists delivery attempts for webhook', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const webhook = await webhookRepository.create({
      organization_id: organization.id,
      url: 'https://example.com/webhooks',
      events: ['subscription.updated'],
      encrypted_secret: 'sample-webhook-secret',
      created_by_user_id: owner.id,
    });

    const webhookId = await attemptRepository.getWebhookId(webhook.public_id, organization.id);
    expect(webhookId).toBe(webhook.id);

    await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'inv_1' },
      status: 'SENT',
      http_status_code: 200,
      response_body: 'ok',
      sent_at: new Date(),
      attempt_count: 1,
    });

    const listed = await attemptRepository.listByWebhook(webhook.id, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('SENT');
  });

  it('getWebhookId returns null for unknown webhook', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const webhookId = await attemptRepository.getWebhookId('missing_webhook', organization.id);
    expect(webhookId).toBeNull();
  });
});
