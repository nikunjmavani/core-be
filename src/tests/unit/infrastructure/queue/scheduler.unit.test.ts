import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { upsertJobSchedulerMock, queueCloseMock } = vi.hoisted(() => ({
  upsertJobSchedulerMock: vi.fn().mockResolvedValue(undefined),
  queueCloseMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    upsertJobScheduler = upsertJobSchedulerMock;
    close = queueCloseMock;
  },
}));

const TOMBSTONE_QUEUE_ORDER = [
  'upload-tombstone-retention',
  'organization-tombstone-retention',
  'webhook-tombstone-retention',
  'organization-notification-policy-tombstone-retention',
  'membership-tombstone-retention',
  'member-role-tombstone-retention',
  'organization-api-key-tombstone-retention',
  'user-tombstone-retention',
] as const;

describe('infrastructure queue scheduler', () => {
  beforeEach(() => {
    upsertJobSchedulerMock.mockClear();
    queueCloseMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('getScheduledJobs returns audit, session, stripe retention, audit export, tombstone retention, idempotency, dlq depth, mail sweeper, upload pending sweep, and stripe reclaim jobs', async () => {
    const { getScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');
    const scheduledJobs = getScheduledJobs();
    expect(scheduledJobs).toHaveLength(21);
    expect(scheduledJobs.map((job) => job.queueName)).toEqual([
      'audit-retention',
      'notification-retention',
      'session-cleanup',
      'stripe-webhook-event-retention',
      'audit-export',
      'user-data-export-retention',
      ...TOMBSTONE_QUEUE_ORDER,
      'idempotency-cardinality',
      'dlq-depth',
      'dlq-auto-retry',
      'commit-dispatch-recovery',
      'mail-outbox-sweeper',
      'upload-pending-sweep',
      'stripe-webhook-event-reclaim',
    ]);
  });

  it('tombstone retention jobs run in FK-safe order (uploads before organizations before users)', async () => {
    const { getScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');
    const scheduledJobs = getScheduledJobs();
    const tombstoneQueues = scheduledJobs
      .map((job) => job.queueName)
      .filter((name) => name.endsWith('-tombstone-retention'));
    expect(tombstoneQueues).toEqual([...TOMBSTONE_QUEUE_ORDER]);
    const uploadIndex = tombstoneQueues.indexOf('upload-tombstone-retention');
    const organizationIndex = tombstoneQueues.indexOf('organization-tombstone-retention');
    const userIndex = tombstoneQueues.indexOf('user-tombstone-retention');
    expect(uploadIndex).toBeLessThan(organizationIndex);
    expect(organizationIndex).toBeLessThan(userIndex);
  });

  it('getScheduledJobs honors AUDIT_RETENTION_CRON from the environment', async () => {
    vi.stubEnv('AUDIT_RETENTION_CRON', '*/7 * * * *');
    const { getScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');
    const scheduledJobs = getScheduledJobs();
    expect(scheduledJobs.find((job) => job.queueName === 'audit-retention')?.cronPattern).toBe(
      '*/7 * * * *',
    );
  });

  it('registerScheduledJobs registers only active queue names when filtered', async () => {
    vi.stubEnv('SCHEDULER_ENABLED', 'true');
    const { registerScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');

    await registerScheduledJobs({
      activeQueueNames: new Set(['mail-outbox-sweeper', 'audit-retention']),
    });

    expect(upsertJobSchedulerMock).toHaveBeenCalledTimes(2);
    const registeredQueues = upsertJobSchedulerMock.mock.calls.map((_call, index) => index);
    expect(registeredQueues).toHaveLength(2);
  });

  it('getScheduledJobs sets timezone on each job when SCHEDULER_TIMEZONE is set', async () => {
    vi.stubEnv('SCHEDULER_TIMEZONE', 'America/New_York');
    const { getScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');
    const scheduledJobs = getScheduledJobs();
    for (const job of scheduledJobs) {
      expect(job.timezone).toBe('America/New_York');
    }
  });

  it('registerScheduledJobs registers one repeatable job per cleanup queue when enabled', async () => {
    const { registerScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');
    const schedulerHandle = await registerScheduledJobs();
    expect(upsertJobSchedulerMock).toHaveBeenCalledTimes(21);
    await schedulerHandle.close();
    expect(queueCloseMock).toHaveBeenCalledTimes(21);
  });

  it('registerScheduledJobs does not instantiate queues when SCHEDULER_ENABLED is false', async () => {
    vi.stubEnv('SCHEDULER_ENABLED', 'false');
    const { registerScheduledJobs } = await import('@/infrastructure/queue/scheduler.js');
    const schedulerHandle = await registerScheduledJobs();
    expect(upsertJobSchedulerMock).not.toHaveBeenCalled();
    expect(queueCloseMock).not.toHaveBeenCalled();
    await schedulerHandle.close();
  });
});
