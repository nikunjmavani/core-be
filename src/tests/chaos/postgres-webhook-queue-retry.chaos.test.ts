import { randomUUID } from 'node:crypto';
import { afterAll, describe, it, vi } from 'vitest';

import { Queue, QueueEvents, type Worker } from 'bullmq';

import { createWebhookDeliveryWorker } from '@/domains/notify/sub-domains/webhook/workers/webhook-delivery.worker.js';
import { database } from '@/infrastructure/database/connection.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { webhook_delivery_attempts } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { CHAOS_POSTGRES_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import {
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  setChaosTestingListeningProxyEnabledAdministrativeSwitch,
} from '@/tests/chaos/helpers/toxiproxy.client.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';

describe('Chaos resilience: BullMQ webhook delivery survives transient Postgres outages', () => {
  const chaosWebhookDeliveryProbeUrlAwaitingIsolation =
    'https://example.org/api/v1/chaos_fixture_webhooks_for_queue_observation/mock-ingest-route';

  let webhookDeliveryWorkerHandleAwaitingObservation: WorkerHandle | null = null;
  let enqueueQueueAwaitingIsolation: Queue | null = null;
  let queueTelemetryListeningForCompletionEventsAwaitingIsolation: QueueEvents | null = null;
  const originalFetchImplementationCapturedBeforeIsolation: typeof globalThis.fetch =
    globalThis.fetch;
  let outboundWebhookFetchSpyAwaitingObservation: ReturnType<typeof vi.spyOn> | null = null;

  afterAll(async () => {
    outboundWebhookFetchSpyAwaitingObservation?.mockRestore();
    await webhookDeliveryWorkerHandleAwaitingObservation?.close();
    await enqueueQueueAwaitingIsolation?.close();
    await queueTelemetryListeningForCompletionEventsAwaitingIsolation?.close();
    globalThis.fetch = originalFetchImplementationCapturedBeforeIsolation;
    vi.restoreAllMocks();
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  });

  it('retries when the first Postgres connection attempt fails midway through toxin exposure', async () => {
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();

    const userAwaitingWebhookFixtureIsolation = await createTestUser();
    const organizationAwaitingWebhookFixtureIsolation = await createTestOrganization({
      ownerUserId: userAwaitingWebhookFixtureIsolation.id,
    });
    const webhookAwaitingDeliveryJobIsolation = await createTestWebhook({
      organizationId: organizationAwaitingWebhookFixtureIsolation.id,
      url: chaosWebhookDeliveryProbeUrlAwaitingIsolation,
      events: ['chaos.webhooks.delivery.probe'],
    });
    const [pendingWebhookDeliveryAttemptAwaitingIsolation] = await database
      .insert(webhook_delivery_attempts)
      .values({
        webhook_id: webhookAwaitingDeliveryJobIsolation.id,
        event_type: 'chaos.webhooks.delivery.probe',
        payload: { simulatedEvent: true },
        status: 'PENDING',
        attempt_count: 0,
      })
      .returning({ id: webhook_delivery_attempts.id });

    webhookDeliveryWorkerHandleAwaitingObservation = createWebhookDeliveryWorker();

    enqueueQueueAwaitingIsolation = new Queue(WEBHOOK_DELIVERY_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    });

    queueTelemetryListeningForCompletionEventsAwaitingIsolation = new QueueEvents(
      WEBHOOK_DELIVERY_QUEUE_NAME,
      {
        connection: getBullMQConnectionOptions(),
      },
    );

    await queueTelemetryListeningForCompletionEventsAwaitingIsolation.waitUntilReady();

    const workerReferenceListeningForIsolation =
      webhookDeliveryWorkerHandleAwaitingObservation.worker;
    await waitUntilWebhookWorkerReferenceSignalsOperationalReadiness(
      workerReferenceListeningForIsolation,
    );

    outboundWebhookFetchSpyAwaitingObservation = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (requestListeningForIsolation, initializerArgumentsAwaitingIsolation) => {
          const inferredHttpMethodListening =
            typeof initializerArgumentsAwaitingIsolation === 'object' &&
            initializerArgumentsAwaitingIsolation !== null &&
            'method' in initializerArgumentsAwaitingIsolation
              ? String(initializerArgumentsAwaitingIsolation.method)
              : typeof requestListeningForIsolation === 'string'
                ? 'GET'
                : 'GET';

          if (inferredHttpMethodListening.toUpperCase() === 'POST') {
            return new Response(JSON.stringify({ delivered: true }), {
              headers: {
                'content-type': 'application/json',
              },
              status: 200,
            });
          }

          return new Response('', { status: 404 });
        },
      );

    await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
      CHAOS_POSTGRES_PROXY_NAME,
      false,
    );

    try {
      const randomJobPublicIdentifierAwaitingIsolation = `chaos-webhook-retry-${randomUUID()}`;

      const waitForMatchedCompletionPromiseListening =
        observeQueueCompletionFilteringByJobPublicIdentifier({
          completionEventsListeningForCorrelation:
            queueTelemetryListeningForCompletionEventsAwaitingIsolation,
          expectedJobPublicIdentifierAwaitingCompletionObservation:
            randomJobPublicIdentifierAwaitingIsolation,
          timeoutMillisecondsAwaitingIsolation: 90_000,
        });

      const enqueueQueueReferenceAwaitingIsolation = enqueueQueueAwaitingIsolation;
      if (!enqueueQueueReferenceAwaitingIsolation) {
        throw new Error(
          'enqueueQueueReferenceAwaitingIsolation was undefined before webhook job submission',
        );
      }

      await enqueueQueueReferenceAwaitingIsolation.add(
        'deliver-webhook',
        {
          deliveryAttemptId: pendingWebhookDeliveryAttemptAwaitingIsolation!.id,
          organizationPublicId: organizationAwaitingWebhookFixtureIsolation.public_id,
        },
        {
          jobId: randomJobPublicIdentifierAwaitingIsolation,
          attempts: 5,
          backoff: {
            delay: 550,
            type: 'fixed',
          },
        },
      );

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });

      await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
        CHAOS_POSTGRES_PROXY_NAME,
        true,
      );
      await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();

      await waitForMatchedCompletionPromiseListening;
    } finally {
      await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
        CHAOS_POSTGRES_PROXY_NAME,
        true,
      ).catch(() => {});
      await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
    }
  });
});

async function waitUntilWebhookWorkerReferenceSignalsOperationalReadiness(
  workerObservationReferenceAwaitingIsolation: Worker | undefined,
): Promise<void> {
  if (!workerObservationReferenceAwaitingIsolation) {
    throw new Error(
      'webhook_delivery.worker_reference_was_undefined_waiting_for_observation_fixture',
    );
  }

  await workerObservationReferenceAwaitingIsolation.waitUntilReady();
}

function observeQueueCompletionFilteringByJobPublicIdentifier(input: {
  completionEventsListeningForCorrelation: QueueEvents;
  expectedJobPublicIdentifierAwaitingCompletionObservation: string | number | undefined | null;
  timeoutMillisecondsAwaitingIsolation: number;
}): Promise<void> {
  return new Promise<void>(
    (resolveCompletionAwaitingIsolation, rejectCompletionAwaitingIsolation) => {
      const observationTimeoutListening = setTimeout(() => {
        input.completionEventsListeningForCorrelation.off(
          'completed',
          onCompletedEventListeningCorrelation,
        );
        rejectCompletionAwaitingIsolation(
          new Error('bullmq.completion_event_timed_out_waiting_for_correlated_fixture'),
        );
      }, input.timeoutMillisecondsAwaitingIsolation);

      const onCompletedEventListeningCorrelation = (payloadAwaitingCorrelation: {
        jobId?: string | number;
      }): void => {
        if (
          String(payloadAwaitingCorrelation.jobId) !==
          String(input.expectedJobPublicIdentifierAwaitingCompletionObservation)
        ) {
          return;
        }

        clearTimeout(observationTimeoutListening);
        input.completionEventsListeningForCorrelation.off(
          'completed',
          onCompletedEventListeningCorrelation,
        );
        resolveCompletionAwaitingIsolation();
      };

      input.completionEventsListeningForCorrelation.on(
        'completed',
        onCompletedEventListeningCorrelation,
      );
    },
  );
}
