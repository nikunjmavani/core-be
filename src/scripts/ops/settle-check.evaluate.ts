/**
 * Pure evaluation logic for the post-load settle-and-assert-clean gate
 * (`pnpm load:settle-check`). Intentionally free of Redis/Postgres imports so it
 * can be unit-tested in isolation; the I/O runner in `settle-check.ts` gathers the
 * live snapshot and delegates the pass/fail decision here.
 */

/** Per-queue BullMQ job-state counts captured in one settle-check sample. */
export interface QueueDepthSnapshot {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

/** In-flight signals the poll loop watches: queue backlog plus pending transactional-outbox rows. */
export interface InFlightSnapshot {
  queues: readonly QueueDepthSnapshot[];
  mailOutboxPending: number;
}

/** Full settle-check sample: the in-flight signals plus the terminal-failure signals asserted once after draining. */
export interface SettleCheckSnapshot extends InFlightSnapshot {
  deadLetterTotal: number;
}

/** Category of a settle-check failure, used to group violations in the report. */
export type SettleCheckViolationKind =
  | 'queue_backlog'
  | 'queue_failed'
  | 'dead_letter'
  | 'mail_outbox_pending';

/** One reason the settle check did not pass, with the offending count. */
export interface SettleCheckViolation {
  kind: SettleCheckViolationKind;
  detail: string;
  count: number;
}

/** Outcome of {@link evaluateSettleCheck}: whether work drained, whether nothing failed, and why. */
export interface SettleCheckEvaluation {
  /** True when no queue holds backlog and the mail outbox has no pending rows. */
  settled: boolean;
  /** True when {@link SettleCheckEvaluation.settled} holds AND no queue/DLQ holds a failed job. */
  passed: boolean;
  violations: readonly SettleCheckViolation[];
}

/** Sum of waiting + active + delayed for one queue — the backlog that must drain to zero. */
export function getQueueBacklog(queue: QueueDepthSnapshot): number {
  return queue.waiting + queue.active + queue.delayed;
}

/** True when every queue backlog is zero and no mail-outbox row is pending dispatch. */
export function isInFlightDrained(snapshot: InFlightSnapshot): boolean {
  if (snapshot.mailOutboxPending > 0) {
    return false;
  }
  return snapshot.queues.every((queue) => getQueueBacklog(queue) === 0);
}

/**
 * Evaluates a settle-check snapshot into a pass/fail decision with itemized
 * violations: per-queue backlog and failed counts, total dead-letter depth, and
 * pending mail-outbox rows. `passed` requires both fully drained and zero failures;
 * `settled` requires only that in-flight work (backlog + outbox) reached zero.
 */
export function evaluateSettleCheck(snapshot: SettleCheckSnapshot): SettleCheckEvaluation {
  const violations: SettleCheckViolation[] = [];

  for (const queue of snapshot.queues) {
    const backlog = getQueueBacklog(queue);
    if (backlog > 0) {
      violations.push({
        kind: 'queue_backlog',
        detail: `${queue.queue} still has ${backlog} job(s) in flight (waiting=${queue.waiting} active=${queue.active} delayed=${queue.delayed})`,
        count: backlog,
      });
    }
    if (queue.failed > 0) {
      violations.push({
        kind: 'queue_failed',
        detail: `${queue.queue} has ${queue.failed} failed job(s)`,
        count: queue.failed,
      });
    }
  }

  if (snapshot.mailOutboxPending > 0) {
    violations.push({
      kind: 'mail_outbox_pending',
      detail: `mail outbox has ${snapshot.mailOutboxPending} pending row(s) awaiting dispatch`,
      count: snapshot.mailOutboxPending,
    });
  }

  if (snapshot.deadLetterTotal > 0) {
    violations.push({
      kind: 'dead_letter',
      detail: `${snapshot.deadLetterTotal} dead-letter job(s) across monitored queues`,
      count: snapshot.deadLetterTotal,
    });
  }

  const settled = !violations.some(
    (violation) => violation.kind === 'queue_backlog' || violation.kind === 'mail_outbox_pending',
  );

  return {
    settled,
    passed: violations.length === 0,
    violations,
  };
}

/** Inputs for {@link formatSettleCheckReport}: the snapshot, its evaluation, and run timing. */
export interface SettleCheckReportInput {
  snapshot: SettleCheckSnapshot;
  evaluation: SettleCheckEvaluation;
  elapsedMilliseconds: number;
  timedOut: boolean;
}

/**
 * Renders a human-readable settle-check report: a per-queue depth table, the
 * outbox/dead-letter totals and elapsed time, then a PASS/FAIL verdict that lists
 * every violation. Returned as a string so the runner and tests share one format.
 */
export function formatSettleCheckReport(input: SettleCheckReportInput): string {
  const { snapshot, evaluation, elapsedMilliseconds, timedOut } = input;
  const lines: string[] = ['Settle check — queue depths:'];

  for (const queue of snapshot.queues) {
    lines.push(
      `  ${queue.queue}: waiting=${queue.waiting} active=${queue.active} delayed=${queue.delayed} failed=${queue.failed}`,
    );
  }
  lines.push(`  mail_outbox_pending=${snapshot.mailOutboxPending}`);
  lines.push(`  dead_letter_total=${snapshot.deadLetterTotal}`);
  lines.push(`  elapsed=${Math.round(elapsedMilliseconds)}ms${timedOut ? ' (TIMED OUT)' : ''}`);
  lines.push('');

  if (evaluation.passed) {
    lines.push('PASS — all work drained and no failed/dead-letter jobs remain.');
    return lines.join('\n');
  }

  lines.push('FAIL — system did not settle clean:');
  for (const violation of evaluation.violations) {
    lines.push(`  [${violation.kind}] ${violation.detail}`);
  }
  return lines.join('\n');
}
