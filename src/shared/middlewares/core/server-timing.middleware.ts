import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '@/shared/config/env.config.js';

/**
 * Adds a `Server-Timing: app;dur=<ms>` response header carrying total server-side processing time,
 * taken from Fastify's per-request timer (`reply.elapsedTime`).
 *
 * @remarks
 * - **Why:** the header is network-independent, so external load tools (k6, curl) and browser
 *   devtools can read the server's true processing latency without scraping `/metrics`. Latency
 *   SLOs measured from a distant client otherwise conflate round-trip time with server work.
 * - **Scope:** wrapped in `fastify-plugin` so the `onSend` hook escapes plugin encapsulation and
 *   applies to every route (including `/livez` and `/readyz`).
 * - **Safety (sec-C/M finding #28):** when `SERVER_TIMING_COARSE` is set (default in production)
 *   the header is coarsened to 5 ms granularity so it cannot serve as a precise side
 *   channel against the auth flows whose constant-time guarantees only hold above the 0.1 ms
 *   precision the prior code emitted. Otherwise the original 0.1 ms precision is retained so dev
 *   tools and load harnesses get the real signal. Setting `HTTP_SERVER_TIMING_ENABLED=false`
 *   suppresses the header entirely.
 */
const SERVER_TIMING_PRODUCTION_GRANULARITY_MS = 5;

const serverTimingMiddleware: FastifyPluginAsync = async (application) => {
  if (!env.HTTP_SERVER_TIMING_ENABLED) {
    return;
  }

  const coarsen = env.SERVER_TIMING_COARSE;

  application.addHook('onSend', async (_request, reply, payload) => {
    const elapsedMs = reply.elapsedTime;
    const headerValue = coarsen
      ? `app;dur=${
          Math.round(elapsedMs / SERVER_TIMING_PRODUCTION_GRANULARITY_MS) *
          SERVER_TIMING_PRODUCTION_GRANULARITY_MS
        }`
      : `app;dur=${elapsedMs.toFixed(1)}`;
    reply.header('Server-Timing', headerValue);
    return payload;
  });
};

export default fp(serverTimingMiddleware, { name: 'server-timing-middleware' });
