import {
  isPrivateOrInternalRedisHost,
  isRedisTlsUrl,
  parseRedisUrl,
} from '@/infrastructure/cache/redis-url.parse.util.js';
import { resolveBullMqRedisUrl } from '@/infrastructure/cache/redis-url.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

interface RedisEndpoint {
  /** Label used in log/error messages (`REDIS_URL` / `REDIS_BULLMQ_URL`). */
  readonly name: string;
  readonly url: string;
}

/** True when a Redis URL is plaintext (`redis://`) AND its host is a public endpoint. */
function isUnencryptedPublicEndpoint(url: string): boolean {
  if (isRedisTlsUrl(url)) return false;
  return !isPrivateOrInternalRedisHost(parseRedisUrl(url).host);
}

function assertEndpointTls({ name, url }: RedisEndpoint): void {
  if (isRedisTlsUrl(url)) {
    return;
  }

  const { host } = parseRedisUrl(url);
  if (isPrivateOrInternalRedisHost(host)) {
    logger.info(
      { endpoint: name, host },
      'redis.tls_safety.private_network: plaintext redis:// permitted on trusted private network',
    );
    return;
  }

  throw new Error(
    `redis.tls_safety.unencrypted: ${name} points at "${host}" over plaintext redis:// on what ` +
      'looks like a public network. In hosted deployments use rediss:// (TLS) for Redis reached ' +
      'over an untrusted network, or keep traffic on a trusted private network ' +
      '(*.railway.internal, *.cluster.local, RFC 1918). ' +
      'See docs/deployment/runbooks/redis-topology.md.',
  );
}

/**
 * Fails closed in hosted deployments when Redis is reached over plaintext `redis://` on a
 * public network. Railway private networking (`redis://*.railway.internal`) and Kubernetes
 * cluster DNS are isolated, so plaintext stays allowed there; any other host must use
 * `rediss://` so cache/idempotency/rate-limit/BullMQ traffic (which carries session and
 * tenant data) is encrypted and the server certificate is verified.
 *
 * @remarks
 * - **Algorithm:** for `REDIS_URL` (and `REDIS_BULLMQ_URL` when it differs), allow
 *   `rediss://`; allow plaintext only when {@link isPrivateOrInternalRedisHost}; otherwise
 *   throw when `REDIS_TLS_ENFORCED` and log a warning otherwise (local/CI).
 * - **Failure modes:** throws `redis.tls_safety.unencrypted` on hosted deployments using
 *   plaintext Redis over a public host.
 * - **Side effects:** emits `redis.tls_safety.*` log lines; performs no network I/O.
 */
export function assertRedisTlsVerification(): void {
  const endpoints: RedisEndpoint[] = [{ name: 'REDIS_URL', url: env.REDIS_URL }];
  const bullMqRedisUrl = resolveBullMqRedisUrl();
  if (bullMqRedisUrl !== env.REDIS_URL) {
    endpoints.push({ name: 'REDIS_BULLMQ_URL', url: bullMqRedisUrl });
  }

  if (!env.REDIS_TLS_ENFORCED) {
    for (const endpoint of endpoints) {
      if (isUnencryptedPublicEndpoint(endpoint.url)) {
        logger.warn(
          { endpoint: endpoint.name },
          'redis.tls_safety.unencrypted_local: plaintext redis:// to a public host on a non-hosted ' +
            'deployment. Acceptable for local/CI; fail-closed in hosted deployments.',
        );
      }
    }
    return;
  }

  for (const endpoint of endpoints) {
    assertEndpointTls(endpoint);
  }
}
