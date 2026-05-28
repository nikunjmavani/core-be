import { Worker, type Job, type WorkerOptions } from 'bullmq';
import type { PostgresDatabaseHandle } from '@/infrastructure/database/database-handle.types.js';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';

/** Explicit Drizzle handle passed from a worker context wrapper into processors/repositories. */
export type WorkerDatabaseHandle = PostgresDatabaseHandle;

export type TenantScopedWorkerJob<TJob> = TJob & {
  organizationPublicId: string;
};

export type TenantScopedJobData = {
  organizationPublicId: string;
};

export type UserScopedWorkerJob<TJob> = TJob & {
  userPublicId: string;
};

/**
 * Runs a tenant-scoped BullMQ job handler with RLS organization context and a pinned database handle.
 */
export async function runTenantScopedWorkerJob<TJob, TResult>(
  job: TenantScopedWorkerJob<TJob>,
  processor: (databaseHandle: WorkerDatabaseHandle, job: TJob) => Promise<TResult>,
): Promise<TResult> {
  const { organizationPublicId, ...jobPayload } = job;
  return withOrganizationContext(organizationPublicId, (databaseHandle) =>
    processor(databaseHandle, jobPayload as TJob),
  );
}

/**
 * Runs a global retention/tombstone worker job with `app.global_retention_cleanup` set.
 */
export async function runGlobalRetentionWorkerJob<TResult>(
  processor: (databaseHandle: WorkerDatabaseHandle) => Promise<TResult>,
): Promise<TResult> {
  return withGlobalRetentionCleanupDatabaseContext((databaseHandle) => processor(databaseHandle));
}

/**
 * Runs a user-scoped worker job with `app.current_user_id` set (GDPR export, etc.).
 */
export async function runUserScopedWorkerJob<TJob, TResult>(
  job: UserScopedWorkerJob<TJob>,
  processor: (databaseHandle: WorkerDatabaseHandle, job: TJob) => Promise<TResult>,
): Promise<TResult> {
  const { userPublicId, ...jobPayload } = job;
  return withUserDatabaseContext(userPublicId, (databaseHandle) =>
    processor(databaseHandle, jobPayload as TJob),
  );
}

/**
 * BullMQ worker factory for jobs that include `organizationPublicId` in the payload.
 * Runs each job inside `withOrganizationContext` and passes a pinned `databaseHandle` to the handler.
 */
export function createTenantScopedBullMQWorker<TJobData extends TenantScopedJobData>(
  queueName: string,
  handler: (databaseHandle: WorkerDatabaseHandle, job: Job<TJobData>) => Promise<unknown>,
  workerOptions: WorkerOptions,
): WorkerHandle {
  const worker = new Worker<TJobData>(
    queueName,
    async (job) => {
      const { organizationPublicId, ...jobPayload } = job.data;
      return runTenantScopedWorkerJob(
        { organizationPublicId, ...(jobPayload as Omit<TJobData, 'organizationPublicId'>) },
        (databaseHandle) => handler(databaseHandle, job),
      );
    },
    workerOptions,
  );
  return buildWorkerHandle(worker, queueName);
}
