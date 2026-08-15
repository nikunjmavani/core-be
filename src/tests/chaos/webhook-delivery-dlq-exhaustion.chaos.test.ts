import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { Queue, QueueEvents } from 'bullmq';

import { createWebhookDeliveryWorker } from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js';
import { webhook_delivery_attempts } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { database } from '@/infrastructure/database/connection.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import {
  attachDeadLetterAndAlerting,
  getDeadLetterQueueName,
} from '@/infrastructure/queue/dlq/dead-letter.js';
import { CHAOS_POSTGRES_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import {
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  setChaosTestingListeningProxyEnabledAdministrativeSwitch,
} from '@/tests/chaos/helpers/toxiproxy.client.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

/**
 * `postgres-webhook-queue-retry` proves the HAPPY end of the retry ladder (a transient
 * outage heals and the job completes). This test proves the OTHER end, which no chaos
 * test covered: when the outage outlives every configured attempt, the job must not
 * evaporate — the dead-letter hook has to move it onto `webhook-delivery-dlq` (a Redis
 * write, deliberately independent of the failing Postgres) with the original job id and
 * attempt accounting intact, because that DLQ entry is what `dlq-replay` and the
 * final-failure alerting operate on.
 */
describe('Chaos resilience: webhook delivery dead-letters after retry exhaustion during a sustained Postgres outage', () => {
  let webhookDeliveryWorkerHandleAwaitingExhaustion: WorkerHandle | null = null;
  let enqueueQueueAwaitingExhaustion: Queue | null = null;
  let deadLetterQueueAwaitingInspection: Queue | null = null;
  let queueTelemetryListeningForFailureEvents: QueueEvents | null = null;

  afterAll(async () => {
    await webhookDeliveryWorkerHandleAwaitingExhaustion?.close();
    await enqueueQueueAwaitingExhaustion?.close();
    await deadLetterQueueAwaitingInspection?.close();
    await queueTelemetryListeningForFailureEvents?.close();
    await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
      CHAOS_POSTGRES_PROXY_NAME,
      true,
    ).catch(() => {});
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  });

  it('moves the exhausted job onto webhook-delivery-dlq with original job accounting', async () => {
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();

    // Fixtures are created while Postgres is still healthy.
    const userForDlqExhaustionFixture = await createTestUser();
    const organizationForDlqExhaustionFixture = await createTestOrganization({
      ownerUserId: userForDlqExhaustionFixture.id,
    });
    const webhookForDlqExhaustionFixture = await createTestWebhook({
      organizationId: organizationForDlqExhaustionFixture.id,
      url: 'https://example.org/api/v1/chaos_fixture_webhooks_for_dlq_observation/ingest',
      events: ['chaos.webhooks.dlq.probe'],
    });
    const [pendingAttemptForDlqExhaustion] = await database
      .insert(webhook_delivery_attempts)
      .values({
        public_id: generatePublicId('webhook'),
        webhook_id: webhookForDlqExhaustionFixture.id,
        event_type: 'chaos.webhooks.dlq.probe',
        payload: { simulatedEvent: true },
        status: 'PENDING',
        attempt_count: 0,
      })
      .returning({ id: webhook_delivery_attempts.id });

    webhookDeliveryWorkerHandleAwaitingExhaustion = createWebhookDeliveryWorker();
    const workerReferenceForDlqAttachment = webhookDeliveryWorkerHandleAwaitingExhaustion.worker;
    if (!workerReferenceForDlqAttachment) {
      throw new Error('webhook_delivery.worker_reference_was_undefined_for_dlq_attachment');
    }
    // The production bootstrap attaches this hook to every worker; the chaos harness
    // builds the worker directly, so attach the same hook the same way.
    attachDeadLetterAndAlerting(workerReferenceForDlqAttachment, WEBHOOK_DELIVERY_QUEUE_NAME);
    await workerReferenceForDlqAttachment.waitUntilReady();

    enqueueQueueAwaitingExhaustion = new Queue(WEBHOOK_DELIVERY_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    });
    queueTelemetryListeningForFailureEvents = new QueueEvents(WEBHOOK_DELIVERY_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
    });
    await queueTelemetryListeningForFailureEvents.waitUntilReady();

    const exhaustionJobPublicIdentifier = `chaos-webhook-dlq-${randomUUID()}`;
    const finalFailureObservedPromise = observeFinalFailureForJobIdentifier({
      failureEventsListeningForCorrelation: queueTelemetryListeningForFailureEvents,
      expectedJobIdentifier: exhaustionJobPublicIdentifier,
      timeoutMilliseconds: 60_000,
    });

    // Sustained outage: Postgres stays unreachable across EVERY attempt.
    await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
      CHAOS_POSTGRES_PROXY_NAME,
      false,
    );

    try {
      await enqueueQueueAwaitingExhaustion.add(
        'deliver-webhook',
        {
          deliveryAttemptId: pendingAttemptForDlqExhaustion!.id,
          organizationPublicId: organizationForDlqExhaustionFixture.public_id,
        },
        {
          jobId: exhaustionJobPublicIdentifier,
          attempts: 2,
          backoff: { delay: 400, type: 'fixed' },
        },
      );

      await finalFailureObservedPromise;
    } finally {
      // Heal Postgres before asserting so teardown and later suites see a healthy pool.
      await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
        CHAOS_POSTGRES_PROXY_NAME,
        true,
      );
      await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
    }

    // The dead-letter entry is a Redis-side write, so it must exist even though every
    // Postgres touch failed. Poll briefly: the DLQ add happens on the worker's 'failed'
    // handler, marginally after the QueueEvents notification.
    deadLetterQueueAwaitingInspection = new Queue(
      getDeadLetterQueueName(WEBHOOK_DELIVERY_QUEUE_NAME),
      { connection: getBullMQConnectionOptions() },
    );
    const deadLetterEntryForExhaustedJob = await pollForDeadLetterEntryByOriginalJobId(
      deadLetterQueueAwaitingInspection,
      exhaustionJobPublicIdentifier,
      15_000,
    );

    expect(deadLetterEntryForExhaustedJob).toBeDefined();
    const deadLetterData = deadLetterEntryForExhaustedJob as {
      original_queue: string;
      original_job_id?: string;
      attempts_made: number;
      max_attempts: number;
    };
    expect(deadLetterData.original_queue).toBe(WEBHOOK_DELIVERY_QUEUE_NAME);
    expect(deadLetterData.attempts_made).toBe(2);
    expect(deadLetterData.max_attempts).toBe(2);
  });
});

function observeFinalFailureForJobIdentifier(input: {
  failureEventsListeningForCorrelation: QueueEvents;
  expectedJobIdentifier: string;
  timeoutMilliseconds: number;
}): Promise<void> {
  return new Promise<void>((resolveFailureObserved, rejectFailureObserved) => {
    const failureObservationTimeout = setTimeout(() => {
      input.failureEventsListeningForCorrelation.off('failed', onFailedEventForCorrelation);
      rejectFailureObserved(
        new Error('bullmq.failed_event_timed_out_waiting_for_exhaustion_fixture'),
      );
    }, input.timeoutMilliseconds);

    const onFailedEventForCorrelation = (payload: { jobId?: string | number }): void => {
      if (String(payload.jobId) !== input.expectedJobIdentifier) return;
      clearTimeout(failureObservationTimeout);
      input.failureEventsListeningForCorrelation.off('failed', onFailedEventForCorrelation);
      resolveFailureObserved();
    };

    input.failureEventsListeningForCorrelation.on('failed', onFailedEventForCorrelation);
  });
}

async function pollForDeadLetterEntryByOriginalJobId(
  deadLetterQueue: Queue,
  originalJobIdentifier: string,
  timeoutMilliseconds: number,
): Promise<unknown | undefined> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const deadLetterJobs = await deadLetterQueue.getJobs(
      ['waiting', 'delayed', 'active', 'completed', 'failed'],
      0,
      200,
    );
    const matched = deadLetterJobs.find(
      (job) => (job.data as { original_job_id?: string }).original_job_id === originalJobIdentifier,
    );
    if (matched) return matched.data;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  return undefined;
}
