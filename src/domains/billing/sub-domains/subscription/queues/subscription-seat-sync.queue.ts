import { Queue } from 'bullmq';
import { getBullMQProducerConnectionOptions } from '@/infrastructure/queue/connection.js';
import { DEFAULT_JOB_RETENTION_COUNT } from '@/infrastructure/queue/queue.constants.js';
import { captureTraceContextForPropagation } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { FIVE_SECONDS_MS, SEVEN_DAYS_SECONDS } from '@/shared/constants/ttl.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  subscriptionSeatSyncJobDataSchema,
  type SubscriptionSeatSyncJobDataValidated,
} from './subscription-seat-sync.job.schema.js';

/** BullMQ queue name for asynchronous Stripe seat-quantity reconciliation (REQ-4). */
export const SUBSCRIPTION_SEAT_SYNC_QUEUE_NAME = 'subscription-seat-sync';

/** Validated payload shape for jobs on the {@link SUBSCRIPTION_SEAT_SYNC_QUEUE_NAME} queue. */
export type SubscriptionSeatSyncJobData = SubscriptionSeatSyncJobDataValidated;

let subscriptionSeatSyncQueue: Queue<SubscriptionSeatSyncJobData> | null = null;

function getSubscriptionSeatSyncQueue(): Queue<SubscriptionSeatSyncJobData> {
  if (subscriptionSeatSyncQueue) return subscriptionSeatSyncQueue;
  subscriptionSeatSyncQueue = new Queue<SubscriptionSeatSyncJobData>(
    SUBSCRIPTION_SEAT_SYNC_QUEUE_NAME,
    {
      connection: getBullMQProducerConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: DEFAULT_JOB_RETENTION_COUNT, age: SEVEN_DAYS_SECONDS },
        removeOnFail: { count: DEFAULT_JOB_RETENTION_COUNT, age: SEVEN_DAYS_SECONDS },
        attempts: 5,
        backoff: { type: 'exponential', delay: FIVE_SECONDS_MS },
      },
    },
  );
  return subscriptionSeatSyncQueue;
}

/**
 * Enqueues a seat-quantity-sync job for an organization (REQ-4). Keyed by
 * `seat-sync-${organizationPublicId}` so a burst of member changes collapses to one pending job —
 * the worker always re-reads the current member count, so coalescing loses nothing.
 *
 * @remarks
 * - **Algorithm:** validates the payload, then `queue.add` with the per-org `jobId` for dedupe.
 * - **Failure modes:** propagates BullMQ enqueue errors; callers in the request path swallow them
 *   so a Redis blip never fails member management (the change already committed locally).
 * - **Side effects:** writes one job to the seat-sync queue.
 */
export async function enqueueSubscriptionSeatSync(options: {
  organizationPublicId: string;
  requestId?: string;
  idempotencyKey?: string;
}): Promise<void> {
  const queue = getSubscriptionSeatSyncQueue();
  const jobData = parseBullMQJobData(
    subscriptionSeatSyncJobDataSchema,
    omitUndefined({
      organizationPublicId: options.organizationPublicId,
      requestId: options.requestId,
      idempotencyKey: options.idempotencyKey,
      ...captureTraceContextForPropagation(),
    }),
    SUBSCRIPTION_SEAT_SYNC_QUEUE_NAME,
  );
  await queue.add('sync-subscription-seats', jobData, {
    jobId: `seat-sync-${options.organizationPublicId}`,
  });
}

/**
 * Best-effort fire-and-forget enqueue used by the request path (member add/remove, change-plan):
 * a Redis failure is logged and swallowed so seat reconciliation never blocks or fails the
 * primary operation. The webhook reconcile + a future periodic sweep are the durability backstop.
 */
export function enqueueSubscriptionSeatSyncBestEffort(options: {
  organizationPublicId: string;
  requestId?: string;
  idempotencyKey?: string;
}): void {
  void enqueueSubscriptionSeatSync(options).catch((error: unknown) => {
    logger.warn(
      { error, organizationPublicId: options.organizationPublicId },
      'subscription.seat_sync.enqueue_failed',
    );
  });
}

/** Closes the lazily-initialised seat-sync queue connection during graceful shutdown. */
export async function closeSubscriptionSeatSyncQueue(): Promise<void> {
  if (subscriptionSeatSyncQueue) {
    await subscriptionSeatSyncQueue.close();
    subscriptionSeatSyncQueue = null;
  }
}
