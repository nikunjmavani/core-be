/**
 * Cross-checks the worker registry's `scheduled` flags against `scheduler.ts`'s canonical
 * cron list. Logs warnings on mismatch (worker tagged `scheduled: true` with no cron, or
 * a cron registered for a queue tagged `scheduled: false`).
 *
 * Mismatches are usually one of:
 * - **Orphan worker**: registered with `scheduled: false` because no cron exists yet.
 *   Operationally inert until either enqueued from a service or wired into `scheduler.ts`.
 * - **Drift**: someone added a cron without flipping `scheduled: true`, or vice versa.
 *
 * A stronger, list-driven invariant — every `maintenance`-criticality worker MUST have a
 * matching `scheduler.ts` entry (registry ⊆ scheduler) — is enforced by
 * {@link findMaintenanceWorkersWithoutSchedule} so that a cron-less retention worker fails
 * the build instead of silently never running.
 */

import { env } from '@/shared/config/env.config.js';
import { getScheduledJobs } from '@/infrastructure/queue/scheduler.js';
import { getWorkerQueueRegistrationDefinitions } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * One drift entry between the worker registry's `scheduled` flag and `scheduler.ts`'s
 * canonical cron list: either a worker claims to be scheduled but has no cron, or a cron
 * exists for a queue whose worker is not marked scheduled.
 */
export type SchedulerRegistryMismatch = {
  readonly queueName: string;
  readonly issue: 'scheduled_flag_without_cron' | 'cron_without_scheduled_flag';
};

/**
 * Diffs the worker registry's `scheduled` flags against the cron list emitted by
 * {@link getScheduledJobs}. Returns the empty array when the two agree; used by both the
 * startup warning ({@link auditSchedulerRegistryConsistency}) and dedicated unit tests so
 * drift fails CI rather than going unnoticed.
 */
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

/**
 * Returns the queue names of every `maintenance`-criticality worker in the registry that
 * has no matching cron in {@link getScheduledJobs} (registry ⊄ scheduler).
 *
 * Maintenance/retention workers are cron-driven by nature — they only run when the
 * scheduler enqueues their repeatable job. A maintenance worker with no scheduler entry is
 * an orphan that never runs, so its table grows unbounded (the exact failure mode that left
 * `notification-retention` and `partition-maintenance` inert). This is asserted as `[]` by a
 * unit test, so any current or future orphan fails the build rather than going unnoticed.
 */
export function findMaintenanceWorkersWithoutSchedule(): string[] {
  const scheduledQueueNames = new Set(getScheduledJobs().map((job) => job.queueName));
  return getWorkerQueueRegistrationDefinitions()
    .filter((definition) => definition.criticality === 'maintenance')
    .filter((definition) => !scheduledQueueNames.has(definition.queueName))
    .map((definition) => definition.queueName);
}

/**
 * Logs a single warning per mismatch found; no-op when registry and scheduler agree.
 *
 * @remarks
 * sec-Q3: in production, a scheduler/registry mismatch silently grows the
 * downstream table (cron enqueues jobs no worker is registered to consume,
 * OR a worker runs without its cron and the table it maintains grows
 * unbounded). Throw to fail boot fast in production; keep WARN in non-prod
 * so tests/dev iteration are not blocked by deliberate split-worker
 * registrations.
 */
export function auditSchedulerRegistryConsistency(): void {
  const mismatches = detectSchedulerRegistryMismatches();
  if (mismatches.length === 0) {
    return;
  }
  if (env.SCHEDULER_REGISTRY_AUDIT_STRICT) {
    throw new Error(
      `worker.registry.scheduler_mismatch — refusing to boot with scheduler/worker registry drift: ${JSON.stringify(mismatches)}`,
    );
  }
  logger.warn({ mismatches }, 'worker.registry.scheduler_mismatch');
}
