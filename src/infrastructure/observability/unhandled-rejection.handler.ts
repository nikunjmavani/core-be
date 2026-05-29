import {
  recordUnhandledRejection,
  type UnhandledRejectionProcess,
} from '@/infrastructure/observability/metrics/prometheus-metrics.js';
import { captureException, flushSentry } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * A single un-awaited promise rejection (often from a dependency) should not tear down the
 * process and drop all in-flight work, so the handler tolerates a burst before escalating to a
 * fatal exit that lets the supervisor restart a genuinely broken process.
 */
const UNHANDLED_REJECTION_BURST_WINDOW_MS = 60_000;

/** Rejections within {@link UNHANDLED_REJECTION_BURST_WINDOW_MS} that force a fatal restart. */
const UNHANDLED_REJECTION_BURST_THRESHOLD = 20;

/** Inputs for {@link createUnhandledRejectionHandler}: the process series + Sentry source tag. */
export interface UnhandledRejectionHandlerOptions {
  process: UnhandledRejectionProcess;
  sentrySource: string;
}

/**
 * Builds the shared `process.on('unhandledRejection')` handler used by both the API server and
 * the worker so their tolerance policy and observability stay identical.
 *
 * @remarks
 * - **Algorithm:** every rejection increments `process_unhandled_rejections_total{process}`,
 *   captures to Sentry, and logs at error level. A rolling 60s window counts rejections; once
 *   {@link UNHANDLED_REJECTION_BURST_THRESHOLD} is reached the handler logs fatal, flushes
 *   Sentry, and exits with code 1 for a supervisor restart.
 * - **Failure modes:** none thrown — the handler must never itself reject. The metric increment
 *   is a no-op when `METRICS_ENABLED=false`, but logging + Sentry capture always run.
 * - **Side effects:** Prometheus counter increment, structured logs, Sentry capture, and (only
 *   on a sustained burst) `process.exit(1)`.
 * - **Notes:** burst state is closed over per handler instance, so each process tracks its own
 *   window. The counter is the key signal — a steady sub-threshold rate is invisible to the
 *   fatal-exit path and can mask a persistent failing code path until metered.
 */
export function createUnhandledRejectionHandler({
  process: processLabel,
  sentrySource,
}: UnhandledRejectionHandlerOptions): (reason: unknown) => void {
  let windowStart = 0;
  let countInWindow = 0;

  return (reason: unknown): void => {
    recordUnhandledRejection(processLabel);
    captureException(reason, { tags: { source: sentrySource } });
    logger.error({ reason }, 'unhandledRejection');

    const now = Date.now();
    if (now - windowStart > UNHANDLED_REJECTION_BURST_WINDOW_MS) {
      windowStart = now;
      countInWindow = 0;
    }
    countInWindow += 1;

    if (countInWindow >= UNHANDLED_REJECTION_BURST_THRESHOLD) {
      logger.fatal(
        {
          unhandledRejectionCountInWindow: countInWindow,
          windowMs: UNHANDLED_REJECTION_BURST_WINDOW_MS,
        },
        'Sustained unhandledRejection burst detected; exiting for supervisor restart',
      );
      void flushSentry().finally(() => process.exit(1));
    }
  };
}
