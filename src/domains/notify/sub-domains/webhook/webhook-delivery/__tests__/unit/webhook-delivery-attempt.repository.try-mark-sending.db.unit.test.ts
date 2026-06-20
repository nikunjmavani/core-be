import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';
import { WebhookDeliveryAttemptRepository } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery-attempt.repository.js';
import { WEBHOOK_DELIVERY_STUCK_SENDING_LEASE_MINUTES } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.constants.js';
import { MILLISECONDS_PER_MINUTE } from '@/shared/constants/ttl.constants.js';

describe('WebhookDeliveryAttemptRepository.tryMarkSending (database)', () => {
  const webhookRepository = new WebhookRepository();
  const attemptRepository = new WebhookDeliveryAttemptRepository();

  async function createWebhookFixture(urlSuffix: string) {
    const owner = await createTestUser({ email: `mark-sending-${urlSuffix}@example.com` });
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const webhook = await webhookRepository.create({
      organization_id: organization.id,
      url: `https://example.com/hook-${urlSuffix}`,
      events: ['subscription.updated'],
      encrypted_secret: 'v1:test',
      created_by_user_id: owner.id,
    });
    return { owner, organization, webhook };
  }

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('tryMarkSending claims pending attempt atomically', async () => {
    const { webhook } = await createWebhookFixture('pending');
    const attempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_1' },
      status: 'PENDING',
      http_status_code: null,
      response_body: null,
      sent_at: null,
      attempt_count: 0,
    });

    const firstResult = await attemptRepository.tryMarkSending(attempt.id, 1);
    expect(firstResult).toBe('claimed');

    const secondResult = await attemptRepository.tryMarkSending(attempt.id, 1);
    expect(secondResult).toBe('in_flight');
  });

  it('tryMarkSending returns in_flight for fresh SENDING row inside the lease window', async () => {
    const { webhook } = await createWebhookFixture('in-flight');
    const freshSentAt = new Date();
    const attempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_2' },
      status: 'SENDING',
      http_status_code: null,
      response_body: null,
      sent_at: freshSentAt,
      attempt_count: 1,
    });

    const result = await attemptRepository.tryMarkSending(attempt.id, 2);
    expect(result).toBe('in_flight');
  });

  it('tryMarkSending reclaims stale SENDING row past the lease window', async () => {
    const { webhook } = await createWebhookFixture('stale');
    const staleSentAt = new Date(
      Date.now() - (WEBHOOK_DELIVERY_STUCK_SENDING_LEASE_MINUTES + 1) * MILLISECONDS_PER_MINUTE,
    );
    const attempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_3' },
      status: 'SENDING',
      http_status_code: null,
      response_body: null,
      sent_at: staleSentAt,
      attempt_count: 1,
    });

    const result = await attemptRepository.tryMarkSending(attempt.id, 2);
    expect(result).toBe('claimed');
  });

  it('tryMarkSending reclaims failed attempt for the next BullMQ retry only once', async () => {
    const { webhook } = await createWebhookFixture('failed-retry');
    const attempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_failed_retry' },
      status: 'FAILED',
      http_status_code: 500,
      response_body: 'server error',
      sent_at: new Date(),
      attempt_count: 1,
    });

    const retryResult = await attemptRepository.tryMarkSending(attempt.id, 2);
    expect(retryResult).toBe('claimed');

    const duplicateRetryResult = await attemptRepository.tryMarkSending(attempt.id, 2);
    expect(duplicateRetryResult).toBe('in_flight');
  });

  it('tryMarkSending returns already_sent for completed (SENT) attempt', async () => {
    const { webhook } = await createWebhookFixture('sent');
    const attempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_4' },
      status: 'SENT',
      http_status_code: 200,
      response_body: 'ok',
      sent_at: new Date(),
      attempt_count: 1,
    });

    const result = await attemptRepository.tryMarkSending(attempt.id, 2);
    expect(result).toBe('already_sent');
  });

  it('recordOutcome never overwrites a terminal SENT row (stale reclaim writer)', async () => {
    // Race: worker A claims and POSTs slowly; the lease expires; worker B reclaims, re-sends,
    // and records SENT. A's slow POST then returns and records FAILED. Without a guard A would
    // flip an already-delivered webhook back to FAILED and trigger a spurious redelivery.
    const { webhook } = await createWebhookFixture('record-outcome-sent');
    const sentAttempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_5' },
      status: 'SENT',
      http_status_code: 200,
      response_body: 'ok',
      sent_at: new Date(),
      attempt_count: 1,
    });

    await attemptRepository.recordOutcome(sentAttempt.id, {
      status: 'FAILED',
      http_status_code: 500,
      response_body: 'late-failure',
      next_retry_at: new Date(),
    });

    const { items } = await attemptRepository.listByWebhook(webhook.id, { limit: 10 });
    const sentRow = items.find((item) => item.id === sentAttempt.id);
    expect(sentRow?.status).toBe('SENT');
    expect(sentRow?.http_status_code).toBe(200);

    // Control: the guard only protects SENT — a SENDING row is still recordable to a terminal
    // outcome (the normal delivery path must keep working).
    const sendingAttempt = await attemptRepository.create({
      webhook_id: webhook.id,
      event_type: 'subscription.updated',
      payload: { id: 'sub_6' },
      status: 'SENDING',
      http_status_code: null,
      response_body: null,
      sent_at: new Date(),
      attempt_count: 1,
    });
    await attemptRepository.recordOutcome(sendingAttempt.id, {
      status: 'SENT',
      http_status_code: 200,
      response_body: 'ok',
    });
    const { items: afterControl } = await attemptRepository.listByWebhook(webhook.id, {
      limit: 10,
    });
    expect(afterControl.find((item) => item.id === sendingAttempt.id)?.status).toBe('SENT');
  });
});
