import { describe, expect, it } from 'vitest';
import {
  buildReplayJobPayload,
  resolveDeadLetterQueueNames,
} from '@/infrastructure/queue/dlq/dlq-replay.util.js';
import type { DeadLetterJobData } from '@/infrastructure/queue/dlq/dead-letter.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

describe('dlq-replay.util', () => {
  it('resolveDeadLetterQueueNames normalizes queue names', () => {
    expect(resolveDeadLetterQueueNames('mail')).toEqual(['mail-dlq']);
  });

  it('buildReplayJobPayload adds replayFromDlq and dlqReplayAttempt for mail', () => {
    const data: DeadLetterJobData = {
      original_queue: MAIL_QUEUE_NAME,
      original_job_id: 'job-1',
      original_job_name: 'send-mail',
      original_data_summary: { mail_outbox_id: 42 },
      failed_reason: 'error',
      attempts_made: 5,
      max_attempts: 5,
      failed_at: new Date().toISOString(),
      replay_attempt: 2,
    };

    expect(buildReplayJobPayload(data)).toEqual({
      mailOutboxId: 42,
      replayFromDlq: true,
      dlqReplayAttempt: 2,
    });
  });

  it('buildReplayJobPayload reconstructs webhook and stripe payloads', () => {
    const webhookData: DeadLetterJobData = {
      original_queue: WEBHOOK_DELIVERY_QUEUE_NAME,
      original_job_id: 'wh-1',
      original_job_name: 'deliver-webhook',
      original_data_summary: {
        delivery_attempt_id: 9,
        organization_public_id: 'org_public_abc',
      },
      failed_reason: 'error',
      attempts_made: 5,
      max_attempts: 5,
      failed_at: new Date().toISOString(),
    };

    const stripeData: DeadLetterJobData = {
      original_queue: STRIPE_WEBHOOK_QUEUE_NAME,
      original_job_id: 'stripe-1',
      original_job_name: 'process-stripe-webhook',
      original_data_summary: { stripe_event_id: 'evt_123' },
      failed_reason: 'error',
      attempts_made: 5,
      max_attempts: 5,
      failed_at: new Date().toISOString(),
    };

    expect(buildReplayJobPayload(webhookData)).toMatchObject({
      deliveryAttemptId: 9,
      organizationPublicId: 'org_public_abc',
      replayFromDlq: true,
      dlqReplayAttempt: 0,
    });
    expect(buildReplayJobPayload(stripeData)).toMatchObject({
      stripeEventId: 'evt_123',
      replayFromDlq: true,
    });
  });
});
