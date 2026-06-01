import { UnrecoverableError, type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const recordDeadLetterFailureMock = vi.fn().mockResolvedValue(undefined);
const loggerErrorMock = vi.fn();

vi.mock('@/infrastructure/queue/dlq/dead-letter.js', () => ({
  recordDeadLetterFailure: (...arguments_: unknown[]) => recordDeadLetterFailureMock(...arguments_),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: {
    error: (...arguments_: unknown[]) => loggerErrorMock(...arguments_),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { parseJobDataOrDeadLetter } from '@/infrastructure/queue/dlq/poison-job.util.js';

const schema = z.object({ mailOutboxId: z.number().int().positive() });

function buildJob(data: unknown): Job {
  return { id: 'job-1', name: 'send-email', data } as unknown as Job;
}

describe('parseJobDataOrDeadLetter', () => {
  beforeEach(() => {
    recordDeadLetterFailureMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it('returns parsed data for a valid payload without touching the DLQ', async () => {
    const job = buildJob({ mailOutboxId: 7 });

    await expect(parseJobDataOrDeadLetter({ schema, job, queueName: 'mail' })).resolves.toEqual({
      mailOutboxId: 7,
    });
    expect(recordDeadLetterFailureMock).not.toHaveBeenCalled();
  });

  it('routes a poison payload straight to the DLQ and throws UnrecoverableError (no retry)', async () => {
    const job = buildJob({ mailOutboxId: 'not-a-number' });

    await expect(
      parseJobDataOrDeadLetter({ schema, job, queueName: 'mail' }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(recordDeadLetterFailureMock).toHaveBeenCalledTimes(1);
    expect(recordDeadLetterFailureMock).toHaveBeenCalledWith(
      'mail',
      job,
      expect.any(UnrecoverableError),
    );
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
  });
});
