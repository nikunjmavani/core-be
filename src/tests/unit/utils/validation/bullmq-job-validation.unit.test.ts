import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';

describe('bullmq-job-validation.util', () => {
  const schema = z.object({
    mailOutboxId: z.number().int().positive(),
    requestId: z.string().optional(),
  });

  it('returns parsed data when payload is valid', () => {
    expect(parseBullMQJobData(schema, { mailOutboxId: 42, requestId: 'req-1' }, 'mail')).toEqual({
      mailOutboxId: 42,
      requestId: 'req-1',
    });
  });

  it('throws when payload is invalid', () => {
    expect(() => parseBullMQJobData(schema, { mailOutboxId: 'bad' }, 'mail')).toThrow(
      /bullmq\.invalid_job_payload:mail/,
    );
  });
});
