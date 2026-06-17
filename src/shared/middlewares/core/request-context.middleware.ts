import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { enterOnCommitScope } from '@/core/events/event-bus.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { extractClientSuppliedRequestIdentifier } from '@/shared/utils/http/fastify-server.util.js';

/**
 * Wall-clock duration (ms) at or above which a request-completion line is logged at `warn`
 * (`request.complete.slow`) even though routine completions are demoted to `debug`, so latency
 * outliers stay visible without the per-request `info` flood.
 */
const SLOW_REQUEST_LOG_THRESHOLD_MS = 1000;

const requestContextMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    enterOnCommitScope();
    (request as { _startAt?: number })._startAt = Date.now();
    reply.header('x-request-id', request.id);
    // sec-C/M finding #27: surface the client-supplied `x-request-id` only as a
    // separate response header (so distributed-tracing clients that DO want their
    // value preserved still get it back) and as a separate `clientRequestId` log
    // field below. The authoritative `request.id` is always the server-minted UUID.
    const clientSupplied = extractClientSuppliedRequestIdentifier(request.headers);
    if (clientSupplied !== undefined) {
      reply.header('x-client-request-id', clientSupplied);
      (request as { _clientRequestId?: string })._clientRequestId = clientSupplied;
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    // Outbox flush moved to request-lifecycle.middleware.ts so it runs strictly after the
    // RLS transaction has committed. This hook now only emits the request completion log.
    if (request.url.startsWith('/livez') || request.url.startsWith('/readyz')) {
      return;
    }

    const startAt = (request as { _startAt?: number })._startAt;
    const durationMs = startAt ? Date.now() - startAt : undefined;
    const clientRequestId = (request as { _clientRequestId?: string })._clientRequestId;

    const routeTemplate = request.routeOptions?.url ?? request.url.split('?')[0];

    // Per-request completion telemetry is already captured by Prometheus (request count + status
    // + latency histograms), so emitting this line at `info` on EVERY request is largely
    // redundant — and a load test attributed a large share of event-loop CPU to it. Routine
    // 2xx/3xx completions are demoted to `debug` (off at the default `info` level); 5xx errors
    // and slow requests stay at `error`/`warn` so the signal you act on is never hidden.
    const completionLog = {
      requestId: request.id,
      ...(clientRequestId !== undefined ? { clientRequestId } : {}),
      method: request.method,
      route: routeTemplate,
      statusCode: reply.statusCode,
      durationMs,
    };
    if (reply.statusCode >= 500) {
      logger.error(completionLog, 'request.complete');
    } else if (durationMs !== undefined && durationMs >= SLOW_REQUEST_LOG_THRESHOLD_MS) {
      logger.warn(completionLog, 'request.complete.slow');
    } else {
      logger.debug(completionLog, 'request.complete');
    }
  });
};

export default fp(requestContextMiddleware, { name: 'request-context-middleware' });
