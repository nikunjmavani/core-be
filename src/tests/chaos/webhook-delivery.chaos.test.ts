import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { Queue, QueueEvents, type Worker } from 'bullmq';

vi.mock('@/shared/utils/security/webhook-outbound-fetch.util.js', () => ({
  createPinnedWebhookFetch: async () => globalThis.fetch,
}));

import { createWebhookDeliveryWorker } from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.js';
import { resetWebhookOutboundCircuitsForTesting } from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-outbound-circuit.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  type WebhookDeliveryJobData,
} from '@/domains/notify/sub-domains/webhook/webhook-delivery/queues/webhook-delivery.queue.js';
import { createPendingWebhookDeliveryAttempt } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.repository.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';

const misbehavingSubscriberWebhookUrl =
  'https://example.org/api/v1/chaos_fixture_webhooks/misbehaving-ingest';
const healthySubscriberWebhookUrl =
  'https://example.org/api/v1/chaos_fixture_webhooks/healthy-ingest';

describe('Chaos resilience: webhook delivery circuit breaker isolates misbehaving subscribers', () => {
  let webhookDeliveryWorkerHandle: WorkerHandle | null = null;
  let enqueueQueue: Queue<WebhookDeliveryJobData> | null = null;
  let queueEvents: QueueEvents | null = null;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterAll(async () => {
    await webhookDeliveryWorkerHandle?.close();
    await enqueueQueue?.close();
    await queueEvents?.close();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    resetWebhookOutboundCircuitsForTesting();
  });

  it('completes delivery for a healthy subscriber while a misbehaving subscriber returns HTTP 500', async () => {
    resetWebhookOutboundCircuitsForTesting();

    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    const misbehavingWebhook = await createTestWebhook({
      organizationId: organization.id,
      url: misbehavingSubscriberWebhookUrl,
      events: ['chaos.webhook.misbehaving'],
    });

    const healthyWebhook = await createTestWebhook({
      organizationId: organization.id,
      url: healthySubscriberWebhookUrl,
      events: ['chaos.webhook.healthy'],
    });

    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method =
        typeof init === 'object' && init !== null && 'method' in init
          ? String(init.method).toUpperCase()
          : 'GET';

      if (method !== 'POST') {
        return new Response('', { status: 404 });
      }

      if (requestUrl.startsWith(misbehavingSubscriberWebhookUrl)) {
        return new Response('internal error', { status: 500, statusText: 'Internal Server Error' });
      }

      if (requestUrl.startsWith(healthySubscriberWebhookUrl)) {
        return new Response(JSON.stringify({ delivered: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('', { status: 404 });
    });

    webhookDeliveryWorkerHandle = createWebhookDeliveryWorker();
    const worker = webhookDeliveryWorkerHandle.worker;
    await waitUntilWorkerReady(worker);

    enqueueQueue = new Queue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
        attempts: 2,
        backoff: { type: 'fixed', delay: 200 },
      },
    });

    queueEvents = new QueueEvents(WEBHOOK_DELIVERY_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
    });
    await queueEvents.waitUntilReady();

    const misbehavingAttemptId = await createPendingWebhookDeliveryAttempt({
      webhookId: misbehavingWebhook.id,
      eventType: 'chaos.webhook.misbehaving',
      payload: { probe: 'misbehaving' },
    });

    const healthyAttemptId = await createPendingWebhookDeliveryAttempt({
      webhookId: healthyWebhook.id,
      eventType: 'chaos.webhook.healthy',
      payload: { probe: 'healthy' },
    });

    if (misbehavingAttemptId === null || healthyAttemptId === null) {
      throw new Error('expected webhook delivery attempt ids from test setup');
    }

    const healthyJobId = `chaos-webhook-healthy-${randomUUID()}`;
    const misbehavingJobId = `chaos-webhook-misbehaving-${randomUUID()}`;

    const healthyCompletion = waitForJobEvent(queueEvents, 'completed', healthyJobId, 90_000);
    const misbehavingFailure = waitForJobEvent(queueEvents, 'failed', misbehavingJobId, 90_000);

    await enqueueQueue.add(
      'deliver-webhook',
      {
        deliveryAttemptId: misbehavingAttemptId,
        organizationPublicId: organization.public_id,
      },
      {
        jobId: misbehavingJobId,
        attempts: 2,
        backoff: { type: 'fixed', delay: 200 },
      },
    );

    await enqueueQueue.add(
      'deliver-webhook',
      {
        deliveryAttemptId: healthyAttemptId,
        organizationPublicId: organization.public_id,
      },
      { jobId: healthyJobId },
    );

    await Promise.all([healthyCompletion, misbehavingFailure]);
  });
});

async function waitUntilWorkerReady(worker: Worker | undefined): Promise<void> {
  if (!worker) {
    throw new Error('webhook_delivery.worker_was_undefined');
  }
  await worker.waitUntilReady();
}

function waitForJobEvent(
  events: QueueEvents,
  eventName: 'completed' | 'failed',
  jobId: string | undefined,
  timeoutMs: number,
  matcher?: (payload: { jobId?: string | number }) => boolean,
): Promise<{ jobId?: string | number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      events.off(eventName, handler);
      reject(new Error(`bullmq.${eventName}_event_timed_out`));
    }, timeoutMs);

    const handler = (payload: { jobId?: string | number }): void => {
      if (jobId !== undefined && String(payload.jobId) !== String(jobId)) {
        return;
      }
      if (matcher && !matcher(payload)) {
        return;
      }
      clearTimeout(timeout);
      events.off(eventName, handler);
      resolve(payload);
    };

    events.on(eventName, handler);
  });
}
