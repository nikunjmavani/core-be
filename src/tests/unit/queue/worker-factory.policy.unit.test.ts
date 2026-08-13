import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedWorker {
  queueName: string;
  processor: (job?: unknown) => Promise<unknown>;
  options: Record<string, unknown>;
  listeners: Map<string, (...args: unknown[]) => void>;
}

const capturedWorkers: CapturedWorker[] = [];
const buildWorkerHandle = vi.fn((_worker: unknown, queueName: string) => ({ queueName }));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      queueName: string,
      processor: (job?: unknown) => Promise<unknown>,
      options: Record<string, unknown>,
    ) {
      capturedWorkers.push({ queueName, processor, options, listeners: new Map() });
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      capturedWorkers[capturedWorkers.length - 1]?.listeners.set(event, listener);
      return this;
    }
  },
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({ __brand: 'bullmq-connection' }),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-options.js', () => ({
  RETENTION_WORKER_CONCURRENCY: 2,
  getRetentionWorkerOptions: () => ({ lockDuration: 600_000, stalledInterval: 60_000 }),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (...args: [unknown, string]) => buildWorkerHandle(...args),
}));

const RETENTION_DATABASE_HANDLE = { __brand: 'global-retention-handle' };
const withGlobalRetentionCleanupDatabaseContext = vi.fn(
  async (callback: (handle: unknown) => unknown) => callback(RETENTION_DATABASE_HANDLE),
);

vi.mock('@/infrastructure/database/contexts/retention-database.context.js', () => ({
  withGlobalRetentionCleanupDatabaseContext: (callback: (handle: unknown) => unknown) =>
    withGlobalRetentionCleanupDatabaseContext(callback),
}));

const processorSpies = {
  uploadPendingSweep: vi.fn(),
  commitDispatchRecovery: vi.fn(),
  mailOutboxSweeper: vi.fn(),
  stripeWebhookEventCatchup: vi.fn(),
  organizationNotificationPolicyTombstone: vi.fn(),
  organizationOffboardingReconcile: vi.fn(),
  userDataExportRetention: vi.fn(),
  userOffboardingReconcile: vi.fn(),
};

vi.mock('@/domains/upload/workers/upload-pending-sweep.processor.js', () => ({
  runUploadPendingSweepJob: (...args: unknown[]) => processorSpies.uploadPendingSweep(...args),
}));
vi.mock('@/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.processor.js', () => ({
  runCommitDispatchRecoveryJob: (...args: unknown[]) =>
    processorSpies.commitDispatchRecovery(...args),
}));
vi.mock('@/infrastructure/mail/workers/mail-outbox-sweeper.processor.js', () => ({
  runMailOutboxSweeperJob: (...args: unknown[]) => processorSpies.mailOutboxSweeper(...args),
}));
vi.mock(
  '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.processor.js',
  () => ({
    runStripeWebhookEventCatchupJob: (...args: unknown[]) =>
      processorSpies.stripeWebhookEventCatchup(...args),
  }),
);
vi.mock(
  '@/domains/tenancy/sub-domains/organization/organization-notification-policy/workers/organization-notification-policy-tombstone-retention.processor.js',
  () => ({
    runOrganizationNotificationPolicyTombstoneRetentionJob: (...args: unknown[]) =>
      processorSpies.organizationNotificationPolicyTombstone(...args),
  }),
);
vi.mock(
  '@/domains/tenancy/sub-domains/organization/workers/organization-offboarding-reconcile.processor.js',
  () => ({
    runOrganizationOffboardingReconcileJob: (...args: unknown[]) =>
      processorSpies.organizationOffboardingReconcile(...args),
  }),
);
vi.mock(
  '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.processor.js',
  () => ({
    runUserDataExportRetentionJob: (...args: unknown[]) =>
      processorSpies.userDataExportRetention(...args),
  }),
);
vi.mock('@/domains/user/workers/user-offboarding-reconcile.processor.js', () => ({
  runUserOffboardingReconcileJob: (...args: unknown[]) =>
    processorSpies.userOffboardingReconcile(...args),
}));

const { createUploadPendingSweepWorker } = await import(
  '@/domains/upload/workers/upload-pending-sweep.worker.js'
);
const { createCommitDispatchRecoveryWorker } = await import(
  '@/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.worker.js'
);
const { createMailOutboxSweeperWorker } = await import(
  '@/infrastructure/mail/workers/mail-outbox-sweeper.worker.js'
);
const { createStripeWebhookEventCatchupWorker } = await import(
  '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-catchup.worker.js'
);
const { createOrganizationNotificationPolicyTombstoneRetentionWorker } = await import(
  '@/domains/tenancy/sub-domains/organization/organization-notification-policy/workers/organization-notification-policy-tombstone-retention.worker.js'
);
const { createOrganizationOffboardingReconcileWorker } = await import(
  '@/domains/tenancy/sub-domains/organization/workers/organization-offboarding-reconcile.worker.js'
);
const { createUserDataExportRetentionWorker } = await import(
  '@/domains/user/sub-domains/user-data-export/workers/user-data-export-retention.worker.js'
);
const { createUserOffboardingReconcileWorker } = await import(
  '@/domains/user/workers/user-offboarding-reconcile.worker.js'
);

const offboardingService = { reconcile: vi.fn() } as never;

/**
 * The eight scheduled-worker factories that had no test.
 *
 * Each is a thin BullMQ wiring function, and the thinness is the hazard: the single most damaging
 * mistake available here is a **queue-name mismatch**. `scheduler.ts` enqueues repeatable jobs onto
 * a queue by name and the worker subscribes by name, with nothing type-level connecting the two.
 * Bind the worker to the wrong string and it starts cleanly, reports healthy, logs nothing — and
 * silently never processes a job. Retention stops running, tombstones accumulate, the offboarding
 * reconcile never fires, and the only symptom is unbounded queue depth nobody is watching. Every
 * factory below is therefore pinned to the exact constant the scheduler uses, and to the fact that
 * the handle it returns is registered under that same name (a handle registered under a different
 * name leaks the worker on shutdown).
 *
 * The second invariant is the RLS boundary from CLAUDE.md. Retention sweeps run cross-tenant, so
 * they must obtain their database handle from `withGlobalRetentionCleanupDatabaseContext` and pass
 * THAT handle down — never reach for the request-scoped pool, which carries no GUC and throws in
 * worker runtime. Asserting the handle is threaded through proves the context wrapper is not merely
 * called and discarded.
 *
 * The third is the concurrency cap: these workers scan broadly, so they run at the retention
 * concurrency rather than the default. An uncapped sweep is a database-pool exhaustion waiting for
 * a big tenant.
 */
describe('scheduled worker factories', () => {
  beforeEach(() => {
    capturedWorkers.length = 0;
    // Implementations are re-seeded, not just cleared: `mockRejectedValue` survives
    // `clearAllMocks`, so the failure-propagation cases would otherwise leak into every test
    // that runs after them.
    vi.clearAllMocks();
    for (const spy of Object.values(processorSpies)) spy.mockResolvedValue(undefined);
    withGlobalRetentionCleanupDatabaseContext.mockImplementation(
      async (callback: (handle: unknown) => unknown) => callback(RETENTION_DATABASE_HANDLE),
    );
  });

  const factories = [
    ['upload-pending-sweep', () => createUploadPendingSweepWorker()],
    ['commit-dispatch-recovery', () => createCommitDispatchRecoveryWorker()],
    ['mail-outbox-sweeper', () => createMailOutboxSweeperWorker()],
    ['stripe-webhook-event-catchup', () => createStripeWebhookEventCatchupWorker()],
    [
      'organization-notification-policy-tombstone-retention',
      () => createOrganizationNotificationPolicyTombstoneRetentionWorker(),
    ],
    [
      'organization-offboarding-reconcile',
      () => createOrganizationOffboardingReconcileWorker(offboardingService),
    ],
    ['user-data-export-retention', () => createUserDataExportRetentionWorker()],
    ['user-offboarding-reconcile', () => createUserOffboardingReconcileWorker(offboardingService)],
  ] as const;

  describe('queue-name binding', () => {
    it.each(factories)('%s subscribes to exactly that queue', (queueName, create) => {
      // A mismatch here is silent: the worker boots, reports healthy, and never processes a job.
      create();

      expect(capturedWorkers).toHaveLength(1);
      expect(capturedWorkers[0]?.queueName).toBe(queueName);
    });

    it.each(factories)('%s registers its handle under the same name', (queueName, create) => {
      // The handle name is what shutdown uses; a divergent name leaks the worker on close.
      create();

      expect(buildWorkerHandle).toHaveBeenCalledWith(expect.anything(), queueName);
    });

    it('binds eight distinct queue names', () => {
      // Two factories pointed at one queue would leave the other queue unserviced — the same
      // silent failure as a typo, and just as invisible.
      for (const [, create] of factories) create();

      const names = capturedWorkers.map((worker) => worker.queueName);
      expect(new Set(names).size).toBe(factories.length);
    });
  });

  describe('worker options', () => {
    it.each(factories)('%s uses the shared BullMQ connection', (_queueName, create) => {
      create();

      expect(capturedWorkers[0]?.options.connection).toEqual({ __brand: 'bullmq-connection' });
    });

    it.each(factories)('%s caps concurrency at the retention limit', (_queueName, create) => {
      create();

      expect(capturedWorkers[0]?.options.concurrency).toBe(2);
    });

    it.each(factories)('%s spreads the retention tuning options', (_queueName, create) => {
      // Long lock/stall windows matter: these batches include S3 and Stripe latency, and a short
      // lock would let BullMQ consider a healthy job stalled and re-run it.
      create();

      expect(capturedWorkers[0]?.options).toMatchObject({
        lockDuration: 600_000,
        stalledInterval: 60_000,
      });
    });

    it.each(factories)('%s registers a stalled listener', (_queueName, create) => {
      create();

      expect(capturedWorkers[0]?.listeners.has('stalled')).toBe(true);
    });

    it.each(factories)('%s stalled listener does not throw', (_queueName, create) => {
      // It only logs, but a throwing listener on an EventEmitter takes the worker process down.
      create();

      expect(() => capturedWorkers[0]?.listeners.get('stalled')?.('job_1')).not.toThrow();
    });
  });

  describe('processor delegation', () => {
    const delegations = [
      ['upload-pending-sweep', () => createUploadPendingSweepWorker(), 'uploadPendingSweep'],
      [
        'commit-dispatch-recovery',
        () => createCommitDispatchRecoveryWorker(),
        'commitDispatchRecovery',
      ],
      ['mail-outbox-sweeper', () => createMailOutboxSweeperWorker(), 'mailOutboxSweeper'],
      [
        'stripe-webhook-event-catchup',
        () => createStripeWebhookEventCatchupWorker(),
        'stripeWebhookEventCatchup',
      ],
      [
        'organization-notification-policy-tombstone-retention',
        () => createOrganizationNotificationPolicyTombstoneRetentionWorker(),
        'organizationNotificationPolicyTombstone',
      ],
      [
        'organization-offboarding-reconcile',
        () => createOrganizationOffboardingReconcileWorker(offboardingService),
        'organizationOffboardingReconcile',
      ],
      [
        'user-data-export-retention',
        () => createUserDataExportRetentionWorker(),
        'userDataExportRetention',
      ],
      [
        'user-offboarding-reconcile',
        () => createUserOffboardingReconcileWorker(offboardingService),
        'userOffboardingReconcile',
      ],
    ] as const;

    it.each(delegations)('%s invokes its processor when a job runs', async (_name, create, spy) => {
      create();

      await capturedWorkers[0]?.processor({ id: 'job_1' });

      expect(processorSpies[spy]).toHaveBeenCalledTimes(1);
    });

    it.each(delegations)('%s propagates a processor failure to BullMQ', async (_n, create, spy) => {
      // Swallowing here would silently disable retry and the DLQ hook — the job would look
      // successful while doing nothing.
      create();
      processorSpies[spy].mockRejectedValue(new Error('processor exploded'));

      await expect(capturedWorkers[0]?.processor({ id: 'job_1' })).rejects.toThrow(
        'processor exploded',
      );
    });

    it('passes the offboarding service through to its processor', async () => {
      createUserOffboardingReconcileWorker(offboardingService);

      await capturedWorkers[0]?.processor({ id: 'job_1' });

      expect(processorSpies.userOffboardingReconcile).toHaveBeenCalledWith(offboardingService);
    });
  });

  describe('RLS boundary for cross-tenant sweeps', () => {
    const retentionFactories = [
      ['upload-pending-sweep', () => createUploadPendingSweepWorker(), 'uploadPendingSweep'],
      [
        'organization-notification-policy-tombstone-retention',
        () => createOrganizationNotificationPolicyTombstoneRetentionWorker(),
        'organizationNotificationPolicyTombstone',
      ],
      [
        'user-data-export-retention',
        () => createUserDataExportRetentionWorker(),
        'userDataExportRetention',
      ],
    ] as const;

    it.each(retentionFactories)(
      '%s runs inside the global-retention database context',
      async (_name, create) => {
        create();

        await capturedWorkers[0]?.processor({ id: 'job_1' });

        expect(withGlobalRetentionCleanupDatabaseContext).toHaveBeenCalledTimes(1);
      },
    );

    it.each(retentionFactories)(
      '%s threads the context handle into its processor',
      async (_name, create, spy) => {
        // Calling the wrapper and then using a different handle would pass the "was it called?"
        // check while still querying without the RLS GUC.
        create();

        await capturedWorkers[0]?.processor({ id: 'job_1' });

        expect(processorSpies[spy]).toHaveBeenCalledWith(RETENTION_DATABASE_HANDLE);
      },
    );

    it.each(retentionFactories)(
      '%s surfaces a context failure rather than running unscoped',
      async (_name, create, spy) => {
        create();
        withGlobalRetentionCleanupDatabaseContext.mockRejectedValue(new Error('no connection'));

        await expect(capturedWorkers[0]?.processor({ id: 'job_1' })).rejects.toThrow(
          'no connection',
        );
        expect(processorSpies[spy]).not.toHaveBeenCalled();
      },
    );
  });
});
