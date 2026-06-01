import {
  isStrictDatabaseTlsVerification,
  parseSslMode,
} from '@/infrastructure/database/utils/connection-url.util.js';
import { isHostedDeployment } from '@/infrastructure/database/utils/hosted-deployment.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Fails closed in hosted deployments unless the Postgres client is configured to verify
 * the server's TLS certificate. With Neon's common `sslmode=require`, traffic is encrypted
 * but the certificate chain is NOT validated, leaving the connection open to an active
 * man-in-the-middle. Strict verification requires either `sslmode=verify-ca` /
 * `sslmode=verify-full` in `DATABASE_URL` or `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
 *
 * @remarks
 * - **Algorithm:** computes {@link isStrictDatabaseTlsVerification} from `DATABASE_URL` +
 *   `DATABASE_SSL_REJECT_UNAUTHORIZED`. When strict, logs `database.tls_safety.ok` and
 *   returns. When not strict and {@link isHostedDeployment} is true, throws. Otherwise
 *   (local/CI) logs a warning so plaintext/unverified local Docker databases keep working.
 * - **Failure modes:** throws `database.tls_safety.unverified` on hosted deployments
 *   without strict verification.
 * - **Side effects:** emits one `database.tls_safety.*` log line; performs no I/O.
 * - **Notes:** prefer `?sslmode=verify-full` with the provider CA bundle (e.g. Neon's
 *   `sslrootcert`) so both the certificate chain and hostname are validated.
 */
export function assertDatabaseTlsVerification(): void {
  const sslMode = parseSslMode(env.DATABASE_URL);
  const strictVerification = isStrictDatabaseTlsVerification({
    databaseUrl: env.DATABASE_URL,
    rejectUnauthorizedOverride: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  });

  if (strictVerification) {
    logger.info({ sslMode }, 'database.tls_safety.ok');
    return;
  }

  if (isHostedDeployment()) {
    throw new Error(
      `database.tls_safety.unverified: DATABASE_URL uses sslmode=${sslMode ?? 'unset'} which does ` +
        'not verify the Postgres server certificate, exposing the connection to man-in-the-middle ' +
        'attacks. In hosted deployments set DATABASE_URL with ?sslmode=verify-full (plus the ' +
        'provider CA bundle) or set DATABASE_SSL_REJECT_UNAUTHORIZED=true. ' +
        'See docs/deployment/runbooks/resource-limits.md.',
    );
  }

  logger.warn(
    { sslMode },
    'database.tls_safety.unverified_local: Postgres TLS certificate verification is off on a ' +
      'non-hosted deployment. Acceptable for local docker-compose / CI plaintext databases; ' +
      'fail-closed in hosted deployments.',
  );
}
