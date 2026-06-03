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
 * - **Safety:** gated by `HTTP_SERVER_TIMING_ENABLED` (default on). The value is coarse
 *   (whole-request only) and authentication paths already run in constant time, so it does not
 *   meaningfully aid timing side-channels; disable the flag to suppress the header entirely.
 */
const serverTimingMiddleware: FastifyPluginAsync = async (application) => {
  if (!env.HTTP_SERVER_TIMING_ENABLED) {
    return;
  }

  application.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Server-Timing', `app;dur=${reply.elapsedTime.toFixed(1)}`);
    return payload;
  });
};

export default fp(serverTimingMiddleware, { name: 'server-timing-middleware' });
