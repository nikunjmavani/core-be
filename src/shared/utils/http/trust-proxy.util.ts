import { env } from '@/shared/config/env.config.js';
import { resolveTrustProxy } from '@/shared/utils/http/fastify-server.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Fails closed in hosted deployments when `TRUST_PROXY` resolves to unset/false/0, and logs
 * the resolved trust-proxy mode at boot.
 *
 * @remarks
 * - **Algorithm:** behind Railway/an edge load balancer the client connects to the proxy, so
 *   without a trusted hop count Fastify reports every request as the proxy IP — collapsing
 *   per-IP rate limits and poisoning `audit.logs.ip_address` with a single value. When
 *   `TRUST_PROXY_REQUIRED` and {@link resolveTrustProxy} is `false`, throws; otherwise it
 *   logs the resolved mode for observability.
 * - **Failure modes:** throws `trust_proxy.hosted_unset` on hosted deployments without a hop
 *   count. Never throws on local/CI (proxy-less) deployments.
 * - **Side effects:** emits one `trust_proxy.resolved` log line; performs no I/O.
 * - **Notes:** Railway fronts each service with exactly one proxy hop, so `TRUST_PROXY=1`.
 *   Add one per additional trusted reverse proxy in front of the app. Kept out of
 *   `fastify-server.util.ts` to avoid a circular import (logger.util ← fastify-server.util).
 */
export function assertHostedTrustProxyConfigured(): void {
  const resolvedTrustProxy = resolveTrustProxy();

  if (resolvedTrustProxy === false && env.TRUST_PROXY_REQUIRED) {
    throw new Error(
      'trust_proxy.hosted_unset: TRUST_PROXY is unset/false in a hosted deployment. Behind ' +
        'Railway or a load balancer this makes every client appear as the proxy IP, collapsing ' +
        'per-IP rate limits and audit IP attribution. Set TRUST_PROXY to the number of trusted ' +
        'reverse-proxy hops (TRUST_PROXY=1 behind Railway). See .env.example.',
    );
  }

  logger.info({ trustProxy: resolvedTrustProxy }, 'trust_proxy.resolved');
}
