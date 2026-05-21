/**
 * Container HEALTHCHECK entrypoint — probes worker GET /health/live (process up + not stalled).
 *
 * Usage: node dist/scripts/admin/worker-health.js
 */
import '@/shared/config/load-env-files.js';
import { env } from '@/shared/config/env.config.js';

const healthHost = env.HTTP_BIND_HOST === '0.0.0.0' ? '127.0.0.1' : env.HTTP_BIND_HOST;
const liveProbeUrl = `http://${healthHost}:${String(env.WORKER_HEALTH_PORT)}/health/live`;

try {
  const response = await fetch(liveProbeUrl, { signal: AbortSignal.timeout(5_000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
