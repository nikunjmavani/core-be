import { lt, lte, type SQL } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logs } from '@/domains/audit/audit.schema.js';
import { dead_letter_jobs } from '@/infrastructure/queue/dlq/dead-letter.schema.js';
import { verification_tokens } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.schema.js';
import { runAuditRetentionJob } from '@/domains/audit/workers/audit-retention.processor.js';

const deleteInBatchesByConditionMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/utils/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...args: unknown[]) => deleteInBatchesByConditionMock(...args),
}));

const environmentMock = vi.hoisted(() => ({ AUDIT_RETENTION_DAYS: 90, LOG_LEVEL: 'silent' }));

vi.mock('@/shared/config/env.config.js', () => ({ env: environmentMock }));

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({ logger: loggerMock }));

/** Frozen clock so the cutoff the processor derives is exactly reproducible in assertions. */
const FROZEN_NOW = new Date('2024-06-15T08:30:00.000Z');

/** sec-D5: verification tokens age out 7 days past expiry, independent of AUDIT_RETENTION_DAYS. */
const VERIFICATION_TOKEN_GRACE_DAYS = 7;

/**
 * Mirrors the processor's own cutoff arithmetic (`setDate(getDate() - days)`), which is
 * local-calendar rather than a millisecond subtraction — replicate it exactly rather than
 * approximating, so the assertion stays correct across DST boundaries.
 */
function cutoffDaysAgo(days: number): Date {
  const cutoff = new Date(FROZEN_NOW);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

interface BatchDeleteCall {
  table: unknown;
  idColumn: unknown;
  whereCondition: SQL;
  logContext: string;
  tableLabel: string;
  databaseHandle: unknown;
}

function batchDeleteCall(index: number): BatchDeleteCall {
  return deleteInBatchesByConditionMock.mock.calls[index]?.[0] as BatchDeleteCall;
}

function startingLogPayload(): { retentionDays: number; cutoffDate: string } {
  const call = loggerMock.info.mock.calls.find(
    ([, message]) => message === 'audit-retention.starting',
  );
  return call?.[0] as { retentionDays: number; cutoffDate: string };
}

function completedLogPayload(): Record<string, number> {
  const call = loggerMock.info.mock.calls.find(
    ([, message]) => message === 'audit-retention.completed',
  );
  return call?.[0] as Record<string, number>;
}

describe('audit-retention.processor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    vi.clearAllMocks();
    environmentMock.AUDIT_RETENTION_DAYS = 90;
    deleteInBatchesByConditionMock
      .mockResolvedValueOnce({ deletedCount: 4, blockedCount: 0 })
      .mockResolvedValueOnce({ deletedCount: 2, blockedCount: 1 })
      // sec-D5: third call is auth.verification_tokens cleanup.
      .mockResolvedValueOnce({ deletedCount: 11, blockedCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runAuditRetentionJob purges audit logs, dead-letter ledger, and expired verification tokens past the window', async () => {
    const result = await runAuditRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledTimes(3);
    expect(batchDeleteCall(0)).toMatchObject({
      logContext: 'audit-retention',
      tableLabel: 'audit.logs',
    });
    expect(batchDeleteCall(1)).toMatchObject({
      logContext: 'audit-retention.dead-letter',
      tableLabel: 'audit.dead_letter_jobs',
    });
    expect(batchDeleteCall(2)).toMatchObject({
      logContext: 'audit-retention.verification-tokens',
      tableLabel: 'auth.verification_tokens',
    });
    expect(result).toEqual({
      deletedCount: 4,
      blockedCount: 0,
      deadLetterDeletedCount: 2,
      deadLetterBlockedCount: 1,
      verificationTokenDeletedCount: 11,
      verificationTokenBlockedCount: 0,
    });
  });

  /**
   * This is the only code in the domain that destroys ledger rows, and the window it destroys
   * by is a config value. A cutoff derived from anything other than `AUDIT_RETENTION_DAYS` — a
   * hardcoded constant, a stale copy, the wrong unit — would silently delete either far too much
   * or nothing at all. Drive it from two different configured windows so a constant cannot pass.
   */
  it('derives the audit.logs cutoff from env.AUDIT_RETENTION_DAYS', async () => {
    await runAuditRetentionJob({} as never);

    expect(batchDeleteCall(0).whereCondition).toEqual(lt(logs.created_at, cutoffDaysAgo(90)));
    expect(startingLogPayload()).toEqual({
      retentionDays: 90,
      cutoffDate: cutoffDaysAgo(90).toISOString(),
    });

    deleteInBatchesByConditionMock.mockReset();
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 0, blockedCount: 0 });
    environmentMock.AUDIT_RETENTION_DAYS = 400;

    await runAuditRetentionJob({} as never);

    expect(batchDeleteCall(0).whereCondition).toEqual(lt(logs.created_at, cutoffDaysAgo(400)));
  });

  /**
   * The predicate must be strict `lt`: a row created exactly at the cutoff instant survives.
   * Flipping to `lte` deletes a boundary row a day early — invisible in any count-based
   * assertion, and irreversible on an append-only ledger.
   */
  it('keeps a row sitting exactly on the cutoff — the predicate is strict lt, not lte', async () => {
    await runAuditRetentionJob({} as never);

    const cutoff = cutoffDaysAgo(90);
    expect(batchDeleteCall(0).whereCondition).toEqual(lt(logs.created_at, cutoff));
    expect(batchDeleteCall(0).whereCondition).not.toEqual(lte(logs.created_at, cutoff));
  });

  /**
   * Every delete goes through `deleteInBatchesByCondition` — never a raw
   * `databaseHandle.delete(...)`. That util is what keeps transactions short and keyset-pages
   * past FK-blocked rows; a direct delete over a 90-day ledger would take one long lock and
   * bloat WAL. Pinned by asserting the handle is only ever forwarded, never used.
   */
  it('routes every delete through the batched helper with the table and id column to keyset on', async () => {
    const databaseHandle = { delete: vi.fn(), execute: vi.fn() };

    await runAuditRetentionJob(databaseHandle as never);

    expect(databaseHandle.delete).not.toHaveBeenCalled();
    expect(databaseHandle.execute).not.toHaveBeenCalled();
    expect(batchDeleteCall(0)).toMatchObject({ databaseHandle, table: logs, idColumn: logs.id });
    expect(batchDeleteCall(1)).toMatchObject({
      databaseHandle,
      table: dead_letter_jobs,
      idColumn: dead_letter_jobs.id,
    });
    expect(batchDeleteCall(2)).toMatchObject({
      databaseHandle,
      table: verification_tokens,
      idColumn: verification_tokens.id,
    });
  });

  /**
   * sec-D5: verification tokens hold a plaintext email plus a token hash, so they age out on a
   * fixed 7-day grace after expiry — deliberately NOT the 90-day audit window. Coupling the two
   * would keep credential-bearing rows around for a full retention period.
   */
  it('purges verification tokens on the 7-day grace, not the audit retention window', async () => {
    await runAuditRetentionJob({} as never);

    expect(batchDeleteCall(2).whereCondition).toEqual(
      lt(verification_tokens.expires_at, cutoffDaysAgo(VERIFICATION_TOKEN_GRACE_DAYS)),
    );
    expect(batchDeleteCall(2).whereCondition).not.toEqual(
      lt(verification_tokens.expires_at, cutoffDaysAgo(90)),
    );
    // The dead-letter ledger, by contrast, is bound to the audit window and pruned by failed_at.
    expect(batchDeleteCall(1).whereCondition).toEqual(
      lt(dead_letter_jobs.failed_at, cutoffDaysAgo(90)),
    );
  });

  /**
   * `blockedCount` is the signal that retention cannot make progress (FK-blocked rows, lock
   * contention). It is only useful if it reaches the logs — a pass that deletes nothing and
   * blocks everything must not look identical to a clean no-op.
   */
  it('logs every deleted and blocked count so a stalled retention pass is observable', async () => {
    await runAuditRetentionJob({} as never);

    expect(completedLogPayload()).toEqual({
      deletedCount: 4,
      blockedCount: 0,
      deadLetterDeletedCount: 2,
      deadLetterBlockedCount: 1,
      verificationTokenDeletedCount: 11,
      verificationTokenBlockedCount: 0,
      retentionDays: 90,
    });
  });

  /**
   * A failing delete must reject so BullMQ retries and the DLQ hook fires. Reporting success on
   * a failed purge would let a compliance window silently lapse — and the later deletes must not
   * run against a connection that just errored.
   */
  it('propagates a database error instead of reporting a successful purge', async () => {
    deleteInBatchesByConditionMock.mockReset();
    deleteInBatchesByConditionMock.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(runAuditRetentionJob({} as never)).rejects.toThrow('deadlock detected');

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledTimes(1);
    expect(completedLogPayload()).toBeUndefined();
  });
});
