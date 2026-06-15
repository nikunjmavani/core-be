import { describe, expect, it } from 'vitest';
import {
  evaluateSettleCheck,
  formatSettleCheckReport,
  getQueueBacklog,
  isInFlightDrained,
  type QueueDepthSnapshot,
  type SettleCheckSnapshot,
} from '@/scripts/ops/settle-check.evaluate.js';

function makeQueue(overrides: Partial<QueueDepthSnapshot> & { queue: string }): QueueDepthSnapshot {
  return { waiting: 0, active: 0, delayed: 0, failed: 0, ...overrides };
}

function makeSnapshot(overrides: Partial<SettleCheckSnapshot> = {}): SettleCheckSnapshot {
  return {
    queues: [makeQueue({ queue: 'mail' }), makeQueue({ queue: 'notification' })],
    mailOutboxPending: 0,
    deadLetterTotal: 0,
    ...overrides,
  };
}

describe('getQueueBacklog', () => {
  it('sums waiting + active + delayed but ignores failed', () => {
    expect(
      getQueueBacklog(makeQueue({ queue: 'mail', waiting: 2, active: 1, delayed: 3, failed: 9 })),
    ).toBe(6);
  });
});

describe('isInFlightDrained', () => {
  it('is true when every queue backlog and the outbox are zero', () => {
    expect(isInFlightDrained(makeSnapshot())).toBe(true);
  });

  it('is false when a queue still has waiting jobs', () => {
    expect(
      isInFlightDrained(makeSnapshot({ queues: [makeQueue({ queue: 'mail', waiting: 1 })] })),
    ).toBe(false);
  });

  it('is false when the mail outbox still has pending rows', () => {
    expect(isInFlightDrained(makeSnapshot({ mailOutboxPending: 4 }))).toBe(false);
  });

  it('ignores failed jobs (a failed-only queue counts as drained)', () => {
    expect(
      isInFlightDrained(makeSnapshot({ queues: [makeQueue({ queue: 'mail', failed: 5 })] })),
    ).toBe(true);
  });
});

describe('evaluateSettleCheck', () => {
  it('passes a fully clean snapshot', () => {
    const evaluation = evaluateSettleCheck(makeSnapshot());
    expect(evaluation).toEqual({ settled: true, passed: true, violations: [] });
  });

  it('reports backlog as not-settled and not-passed', () => {
    const evaluation = evaluateSettleCheck(
      makeSnapshot({ queues: [makeQueue({ queue: 'mail', waiting: 2, delayed: 1 })] }),
    );
    expect(evaluation.settled).toBe(false);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.violations).toHaveLength(1);
    expect(evaluation.violations[0]).toMatchObject({ kind: 'queue_backlog', count: 3 });
  });

  it('treats failed jobs as settled-but-not-clean', () => {
    const evaluation = evaluateSettleCheck(
      makeSnapshot({ queues: [makeQueue({ queue: 'webhook-delivery', failed: 2 })] }),
    );
    expect(evaluation.settled).toBe(true);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.violations[0]).toMatchObject({ kind: 'queue_failed', count: 2 });
  });

  it('flags dead-letter depth while still counting as settled', () => {
    const evaluation = evaluateSettleCheck(makeSnapshot({ deadLetterTotal: 7 }));
    expect(evaluation.settled).toBe(true);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.violations[0]).toMatchObject({ kind: 'dead_letter', count: 7 });
  });

  it('flags pending mail outbox as not-settled', () => {
    const evaluation = evaluateSettleCheck(makeSnapshot({ mailOutboxPending: 3 }));
    expect(evaluation.settled).toBe(false);
    expect(evaluation.violations[0]).toMatchObject({ kind: 'mail_outbox_pending', count: 3 });
  });

  it('collects every distinct violation in one pass', () => {
    const evaluation = evaluateSettleCheck(
      makeSnapshot({
        queues: [makeQueue({ queue: 'mail', waiting: 1, failed: 2 })],
        mailOutboxPending: 1,
        deadLetterTotal: 1,
      }),
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.violations.map((violation) => violation.kind)).toEqual([
      'queue_backlog',
      'queue_failed',
      'mail_outbox_pending',
      'dead_letter',
    ]);
  });
});

describe('formatSettleCheckReport', () => {
  it('renders a PASS verdict with the depth table', () => {
    const report = formatSettleCheckReport({
      snapshot: makeSnapshot(),
      evaluation: evaluateSettleCheck(makeSnapshot()),
      elapsedMilliseconds: 1234.6,
      timedOut: false,
    });
    expect(report).toContain('PASS');
    expect(report).toContain('mail: waiting=0 active=0 delayed=0 failed=0');
    expect(report).toContain('elapsed=1235ms');
    expect(report).not.toContain('TIMED OUT');
  });

  it('renders a FAIL verdict listing every violation and the timeout marker', () => {
    const snapshot = makeSnapshot({
      queues: [makeQueue({ queue: 'mail', waiting: 1 })],
      deadLetterTotal: 2,
    });
    const report = formatSettleCheckReport({
      snapshot,
      evaluation: evaluateSettleCheck(snapshot),
      elapsedMilliseconds: 120_000,
      timedOut: true,
    });
    expect(report).toContain('FAIL');
    expect(report).toContain('(TIMED OUT)');
    expect(report).toContain('[queue_backlog]');
    expect(report).toContain('[dead_letter]');
  });
});
