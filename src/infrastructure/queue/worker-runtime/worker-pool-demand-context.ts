import type { WorkerPostgresPoolDemandReport } from '@/infrastructure/queue/worker-runtime/worker-connection-budget.js';

let workerPoolDemandReport: WorkerPostgresPoolDemandReport | undefined;

/**
 * Stores the {@link WorkerPostgresPoolDemandReport} computed at worker bootstrap so other
 * modules (pool-pressure alerts, `/health` enrichment, readiness probes) can read the
 * current process's Postgres demand without recomputing it.
 */
export function setWorkerPostgresPoolDemandContext(report: WorkerPostgresPoolDemandReport): void {
  workerPoolDemandReport = report;
}

/** Returns the report cached by {@link setWorkerPostgresPoolDemandContext}, or `undefined` in API processes. */
export function getWorkerPostgresPoolDemandContext(): WorkerPostgresPoolDemandReport | undefined {
  return workerPoolDemandReport;
}

/** Test-only reset. */
export function resetWorkerPostgresPoolDemandContextForTests(): void {
  workerPoolDemandReport = undefined;
}
