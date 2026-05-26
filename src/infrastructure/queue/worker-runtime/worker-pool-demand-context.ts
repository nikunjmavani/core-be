import type { WorkerPostgresPoolDemandReport } from '@/infrastructure/queue/worker-runtime/worker-connection-budget.js';

let workerPoolDemandReport: WorkerPostgresPoolDemandReport | undefined;

export function setWorkerPostgresPoolDemandContext(report: WorkerPostgresPoolDemandReport): void {
  workerPoolDemandReport = report;
}

export function getWorkerPostgresPoolDemandContext(): WorkerPostgresPoolDemandReport | undefined {
  return workerPoolDemandReport;
}

/** Test-only reset. */
export function resetWorkerPostgresPoolDemandContextForTests(): void {
  workerPoolDemandReport = undefined;
}
