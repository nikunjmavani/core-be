import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import {
  isStripeConfigured,
  isStripeWebhookIngressConfigured,
} from '@/infrastructure/payment/stripe.client.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { RETENTION_WORKER_CONCURRENCY } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import {
  getWorkerQueueRegistrationDefinitions,
  getWorkerRegistrationsForFamilies,
  type WorkerCriticality,
  type WorkerQueueRegistrationDefinition,
} from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import type { WorkerQueueFamily } from '@/infrastructure/queue/worker-runtime/worker-queue-family.constants.js';
import {
  getSelectedWorkerQueueFamilies,
  isMonolithicWorkerQueueFamilies,
} from '@/infrastructure/queue/worker-runtime/worker-queue-family.util.js';
import type { WorkerContainers } from '@/worker-containers.js';

/**
 * Per-queue contribution to the worker's Postgres pool budget. `postgresConcurrency` is
 * the BullMQ concurrency this queue runs at when enabled (0 when the worker is gated off
 * by `isEnabled`, e.g. missing Resend/Stripe secrets), and
 * `holdsConnectionDuringExternalIo` flags workers that keep their pool checkout while
 * doing outbound HTTP/S3 work — those amplify pool starvation under slow externals.
 */
export type WorkerPostgresQueueDemandEntry = {
  readonly queueName: string;
  readonly family: WorkerQueueFamily;
  readonly criticality: WorkerCriticality;
  readonly postgresConcurrency: number;
  readonly holdsConnectionDuringExternalIo: boolean;
  readonly enabled: boolean;
};

/**
 * Aggregated Postgres-pool demand for this worker process, summed across every enabled
 * BullMQ worker in the selected {@link WorkerQueueFamily}s. Used at bootstrap to log
 * `worker.queue_families.selected` and to gate replica-mode pool sizing.
 */
export type WorkerPostgresPoolDemandReport = {
  readonly selectedFamilies: readonly WorkerQueueFamily[];
  readonly monolithicWorker: boolean;
  readonly peakPostgresConcurrency: number;
  /**
   * Subset of `peakPostgresConcurrency` from workers that hold the pool checkout while
   * making outbound HTTP/S3/Resend calls. Slow externals here translate to pool starvation.
   */
  readonly peakPostgresConcurrencyHoldingExternalIo: number;
  readonly queues: readonly WorkerPostgresQueueDemandEntry[];
};

function isRegistrationEnabled(
  definition: WorkerQueueRegistrationDefinition,
  workerContainers: WorkerContainers | undefined,
): boolean {
  if (definition.isEnabled === undefined) {
    return true;
  }
  if (workerContainers === undefined) {
    if (definition.queueName === MAIL_QUEUE_NAME) {
      return isMailConfigured();
    }
    if (definition.queueName === STRIPE_WEBHOOK_QUEUE_NAME) {
      return isStripeConfigured() && isStripeWebhookIngressConfigured();
    }
    return true;
  }
  return definition.isEnabled(workerContainers);
}

function resolvePostgresConcurrency(
  definition: WorkerQueueRegistrationDefinition,
  workerContainers: WorkerContainers | undefined,
): number {
  if (!definition.usesPostgres) {
    return 0;
  }
  if (definition.resolvePostgresConcurrency !== undefined) {
    return definition.resolvePostgresConcurrency(workerContainers);
  }
  return RETENTION_WORKER_CONCURRENCY;
}

/**
 * Computes peak simultaneous Postgres checkouts this worker process can demand from
 * enabled BullMQ workers in the selected queue families.
 */
export function computeWorkerPostgresPoolDemand(
  options: {
    readonly families?: readonly WorkerQueueFamily[];
    readonly workerContainers?: WorkerContainers;
  } = {},
): WorkerPostgresPoolDemandReport {
  const selectedFamilies = options.families ?? getSelectedWorkerQueueFamilies();
  const familySet = new Set(selectedFamilies);
  const definitions = getWorkerQueueRegistrationDefinitions().filter((definition) =>
    familySet.has(definition.family),
  );

  const queues: WorkerPostgresQueueDemandEntry[] = definitions.map((definition) => {
    const enabled = isRegistrationEnabled(definition, options.workerContainers);
    const postgresConcurrency = enabled
      ? resolvePostgresConcurrency(definition, options.workerContainers)
      : 0;
    return {
      queueName: definition.queueName,
      family: definition.family,
      criticality: definition.criticality,
      postgresConcurrency,
      holdsConnectionDuringExternalIo: definition.holdsConnectionDuringExternalIo === true,
      enabled,
    };
  });

  const peakPostgresConcurrency = queues.reduce(
    (peak, entry) => peak + entry.postgresConcurrency,
    0,
  );
  const peakPostgresConcurrencyHoldingExternalIo = queues.reduce(
    (peak, entry) => peak + (entry.holdsConnectionDuringExternalIo ? entry.postgresConcurrency : 0),
    0,
  );

  return {
    selectedFamilies,
    monolithicWorker: isMonolithicWorkerQueueFamilies(selectedFamilies),
    peakPostgresConcurrency,
    peakPostgresConcurrencyHoldingExternalIo,
    queues,
  };
}

/** Queue names with an active worker in this process (for scheduler registration). */
export function resolveActiveWorkerQueueNames(
  options: {
    readonly families?: readonly WorkerQueueFamily[];
    readonly workerContainers?: WorkerContainers;
  } = {},
): ReadonlySet<string> {
  const selectedFamilies = options.families ?? getSelectedWorkerQueueFamilies();
  const definitions = getWorkerRegistrationsForFamilies(selectedFamilies);
  const names = new Set<string>();

  for (const definition of definitions) {
    if (isRegistrationEnabled(definition, options.workerContainers)) {
      names.add(definition.queueName);
    }
  }

  return names;
}
