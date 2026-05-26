/**
 * Cross-checks the worker registry's `scheduled` flags against `scheduler.ts`'s canonical
 * cron list. Logs warnings on mismatch (worker tagged `scheduled: true` with no cron, or
 * a cron registered for a queue tagged `scheduled: false`).
 *
 * Mismatches are usually one of:
 * - **Orphan worker**: registered with `scheduled: false` because no cron exists yet
 *   (e.g. `partition-maintenance`, `notification-retention`). Operationally inert until
 *   either enqueued from a service or wired into `scheduler.ts`.
 * - **Drift**: someone added a cron without flipping `scheduled: true`, or vice versa.
 */

import { getScheduledJobs } from '@/infrastructure/queue/scheduler.js';
import { getWorkerQueueRegistrationDefinitions } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

export type SchedulerRegistryMismatch = {
  readonly queueName: string;
  readonly issue: 'scheduled_flag_without_cron' | 'cron_without_scheduled_flag';
};

export function detectSchedulerRegistryMismatches(): SchedulerRegistryMismatch[] {
  const scheduledQueueNames = new Set(getScheduledJobs().map((job) => job.queueName));
  const registry = getWorkerQueueRegistrationDefinitions();
  const mismatches: SchedulerRegistryMismatch[] = [];

  for (const definition of registry) {
    const hasCron = scheduledQueueNames.has(definition.queueName);
    if (definition.scheduled && !hasCron) {
      mismatches.push({
        queueName: definition.queueName,
        issue: 'scheduled_flag_without_cron',
      });
    } else if (!definition.scheduled && hasCron) {
      mismatches.push({
        queueName: definition.queueName,
        issue: 'cron_without_scheduled_flag',
      });
    }
  }

  return mismatches;
}

/** Logs a single warning per mismatch found; no-op when registry and scheduler agree. */
export function auditSchedulerRegistryConsistency(): void {
  const mismatches = detectSchedulerRegistryMismatches();
  if (mismatches.length === 0) {
    return;
  }
  logger.warn({ mismatches }, 'worker.registry.scheduler_mismatch');
}
