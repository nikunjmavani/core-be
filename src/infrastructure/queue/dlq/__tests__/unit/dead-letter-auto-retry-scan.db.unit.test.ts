import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { database } from '@/infrastructure/database/connection.js';
import { dead_letter_jobs } from '@/infrastructure/queue/dlq/dead-letter.schema.js';
import {
  findDeadLetterJobsForAutoRetry,
  markDeadLetterJobAutoRetryResolved,
} from '@/infrastructure/queue/dlq/dead-letter.repository.js';

/**
 * Regression for the DLQ auto-retry starvation fix: the scan must exclude rows already marked
 * `auto_retry_resolved_at`, so budget-exhausted rows can never re-enter the head of the queue and
 * starve newer replayable rows (nor replay again after the Redis budget counter expires).
 */
async function seedDeadLetterRow(overrides: Partial<typeof dead_letter_jobs.$inferInsert> = {}) {
  const oneHourAgo = new Date(Date.now() - 3_600_000);
  const [row] = await database
    .insert(dead_letter_jobs)
    .values({
      source_queue: 'mail',
      dead_letter_queue: 'mail-dlq',
      job_name: 'send-email',
      payload_summary: {},
      failed_reason: 'boom',
      attempts_made: 3,
      max_attempts: 3,
      failed_at: oneHourAgo,
      ...overrides,
    })
    .returning();
  return row!;
}

function scan() {
  return findDeadLetterJobsForAutoRetry({
    sourceQueues: ['mail'],
    failedBefore: new Date(),
    limit: 50,
  });
}

describe('DLQ auto-retry scan — resolved-row exclusion', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('excludes rows already marked auto_retry_resolved_at', async () => {
    const unresolved = await seedDeadLetterRow({ failed_reason: 'unresolved' });
    const resolved = await seedDeadLetterRow({
      failed_reason: 'resolved',
      auto_retry_resolved_at: new Date(),
    });

    const ids = (await scan()).map((row) => row.id);
    expect(ids).toContain(unresolved.id);
    expect(ids).not.toContain(resolved.id);
  });

  it('markDeadLetterJobAutoRetryResolved removes a row from the scan (idempotent)', async () => {
    const row = await seedDeadLetterRow();
    expect((await scan()).map((found) => found.id)).toContain(row.id);

    await markDeadLetterJobAutoRetryResolved(row.id);
    expect((await scan()).map((found) => found.id)).not.toContain(row.id);

    // Idempotent: a second mark is a harmless no-op.
    await expect(markDeadLetterJobAutoRetryResolved(row.id)).resolves.toBeUndefined();
    expect((await scan()).map((found) => found.id)).not.toContain(row.id);
  });
});
