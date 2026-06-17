import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '@/shared/config/env.config.js';
import { ServiceUnavailableError } from '@/shared/errors/index.js';

/** Sampling cadence for the event-loop-delay probe (ms). */
const OVERLOAD_SAMPLE_INTERVAL_MS = 500;

/** perf_hooks histogram resolution (ms) — matches the Prometheus event-loop-lag probe. */
const EVENT_LOOP_MONITORING_RESOLUTION_MS = 10;

/** `Retry-After` (seconds) advertised on a shed 503 so clients back off instead of hot-looping. */
const OVERLOAD_RETRY_AFTER_SECONDS = 1;

/**
 * Paths never shed: liveness/readiness must answer so the orchestrator does not kill or de-route a
 * process that is merely busy, and `/metrics` must stay scrapable during overload.
 */
const OVERLOAD_ALLOWLISTED_PATHS = new Set(['/livez', '/readyz', '/metrics']);

/**
 * Pure shed decision for the overload guard: returns `true` when a request should be rejected
 * with 503.
 *
 * @remarks
 * Allowlisted paths ({@link OVERLOAD_ALLOWLISTED_PATHS}) are never shed; any other path sheds once
 * the recent p99 event-loop delay has reached `thresholdMs`. Extracted as a pure function so the
 * decision is unit-testable without driving the real event loop or fake timers.
 */
export function shouldShedRequest(options: {
  path: string;
  recentEventLoopDelayMs: number;
  thresholdMs: number;
}): boolean {
  if (OVERLOAD_ALLOWLISTED_PATHS.has(options.path)) {
    return false;
  }
  return options.recentEventLoopDelayMs >= options.thresholdMs;
}

/**
 * Load-shedding valve: returns `503 Service Unavailable` (with `Retry-After`) on `onRequest` when
 * recent p99 event-loop delay exceeds the configured `OVERLOAD_MAX_EVENT_LOOP_DELAY_MS` (env).
 *
 * @remarks
 * - **Algorithm:** a `monitorEventLoopDelay` histogram is sampled every
 *   {@link OVERLOAD_SAMPLE_INTERVAL_MS} and reset each tick to track the *recent* window; the
 *   `onRequest` hook reads the cached p99 (no per-request syscall) and throws
 *   {@link ServiceUnavailableError} when the loop is stalled.
 * - **Why:** without a valve, a backlog grows an unbounded queue and tail latency runs to multiple
 *   seconds. Shedding bounds the tail — requests the box cannot serve promptly get a fast, cheap
 *   503 instead of occupying a worker for seconds. Delay (not utilization) is the discriminating
 *   signal — under sustained concurrency utilization pegs near 1.0 even while the box copes, so an
 *   ELU threshold would shed healthy traffic. Threshold is `env.OVERLOAD_MAX_EVENT_LOOP_DELAY_MS`.
 * - **Failure modes:** none surfaced to healthy traffic — at a sane threshold the guard is dormant
 *   under normal load. Allowlisted health/metrics paths are never shed.
 * - **Side effects:** one `monitorEventLoopDelay` histogram + one unref'd interval timer (both
 *   cleared on `onClose`); throws on shed.
 */
const overloadGuardMiddleware: FastifyPluginAsync = async (application) => {
  const shedThresholdMs = env.OVERLOAD_MAX_EVENT_LOOP_DELAY_MS;
  let recentEventLoopDelayMs = 0;
  const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_MONITORING_RESOLUTION_MS });
  histogram.enable();

  const sampleTimer = setInterval(() => {
    recentEventLoopDelayMs = histogram.percentile(99) / 1_000_000;
    histogram.reset();
  }, OVERLOAD_SAMPLE_INTERVAL_MS);
  sampleTimer.unref();
  application.addHook('onClose', async () => {
    clearInterval(sampleTimer);
    histogram.disable();
  });

  application.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '';
    if (shouldShedRequest({ path, recentEventLoopDelayMs, thresholdMs: shedThresholdMs })) {
      reply.header('Retry-After', String(OVERLOAD_RETRY_AFTER_SECONDS));
      throw new ServiceUnavailableError();
    }
  });
};

export default fp(overloadGuardMiddleware, { name: 'overload-guard-middleware' });
