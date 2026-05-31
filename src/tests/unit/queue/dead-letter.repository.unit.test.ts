import { beforeEach, describe, expect, it, vi } from 'vitest';

const valuesMock = vi.fn().mockResolvedValue(undefined);
const insertMock = vi.fn((..._arguments: unknown[]) => ({ values: valuesMock }));

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    insert: (...arguments_: unknown[]) => insertMock(...arguments_),
  },
}));

describe('insertDeadLetterJob', () => {
  beforeEach(() => {
    insertMock.mockClear();
    valuesMock.mockClear();
    valuesMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it('inserts the dead-letter record into audit.dead_letter_jobs with mapped columns', async () => {
    const { insertDeadLetterJob } = await import(
      '@/infrastructure/queue/dlq/dead-letter.repository.js'
    );
    const { dead_letter_jobs } = await import('@/infrastructure/queue/dlq/dead-letter.schema.js');

    const failedAt = new Date('2026-05-29T12:00:00.000Z');
    await insertDeadLetterJob({
      source_queue: 'notification',
      dead_letter_queue: 'notification-dlq',
      job_id: 'job-42',
      job_name: 'dispatch-notification',
      payload_summary: { notification_id: 42 },
      failed_reason: 'permanent failure',
      error_stack: 'Error: permanent failure\n    at worker',
      attempts_made: 3,
      max_attempts: 3,
      failed_at: failedAt,
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(dead_letter_jobs);
    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith({
      source_queue: 'notification',
      dead_letter_queue: 'notification-dlq',
      job_id: 'job-42',
      job_name: 'dispatch-notification',
      payload_summary: { notification_id: 42 },
      failed_reason: 'permanent failure',
      error_stack: 'Error: permanent failure\n    at worker',
      attempts_made: 3,
      max_attempts: 3,
      failed_at: failedAt,
    });
  });

  it('propagates a null job_id and error_stack without coercion', async () => {
    const { insertDeadLetterJob } = await import(
      '@/infrastructure/queue/dlq/dead-letter.repository.js'
    );

    await insertDeadLetterJob({
      source_queue: 'mail',
      dead_letter_queue: 'mail-dlq',
      job_id: null,
      job_name: 'send-email',
      payload_summary: {},
      failed_reason: 'boom',
      error_stack: null,
      attempts_made: 0,
      max_attempts: 1,
      failed_at: new Date('2026-05-29T12:00:00.000Z'),
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: null, error_stack: null }),
    );
  });

  it('propagates database insert failures to the caller', async () => {
    valuesMock.mockRejectedValueOnce(new Error('postgres-down'));
    const { insertDeadLetterJob } = await import(
      '@/infrastructure/queue/dlq/dead-letter.repository.js'
    );

    await expect(
      insertDeadLetterJob({
        source_queue: 'mail',
        dead_letter_queue: 'mail-dlq',
        job_id: 'job-1',
        job_name: 'send-email',
        payload_summary: {},
        failed_reason: 'boom',
        error_stack: null,
        attempts_made: 1,
        max_attempts: 3,
        failed_at: new Date(),
      }),
    ).rejects.toThrow('postgres-down');
  });
});
