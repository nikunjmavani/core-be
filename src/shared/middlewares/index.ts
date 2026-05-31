import type { FastifyInstance } from 'fastify';
import requestLifecycleMiddleware from './core/request-lifecycle.middleware.js';
import compressMiddleware from './core/compress.middleware.js';
import cookieMiddleware from './session/cookie.middleware.js';
import helmetMiddleware from './security/helmet.middleware.js';
import corsMiddleware from './security/cors.middleware.js';
import rateLimitMiddleware from './rate-limit/rate-limit.middleware.js';
import errorHandlerMiddleware from './core/error-handler.middleware.js';
import responseFormatMiddleware from './core/response-format.middleware.js';
import apiVersioningMiddleware from './core/api-versioning.middleware.js';
import requestContextMiddleware from './core/request-context.middleware.js';
import i18nMiddleware from './core/i18n.middleware.js';
import idempotencyMiddleware from './core/idempotency.middleware.js';
import encryptionMiddleware from './security/encryption.middleware.js';
import authMiddleware from './core/auth.middleware.js';
import zodTypeProviderMiddleware from './core/zod-type-provider.middleware.js';
import tenantMiddleware from './tenant/tenant.middleware.js';
import organizationRlsTransactionMiddleware from './tenant/organization-rls-transaction.middleware.js';
import requestStatementTimeoutMiddleware from './core/request-statement-timeout.middleware.js';
import healthMiddleware from './core/health.middleware.js';
import httpMetricsPlugin from '@/infrastructure/observability/metrics/http-metrics.plugin.js';
import metricsMiddleware from './core/metrics.middleware.js';
import shutdownMiddleware from './core/shutdown.middleware.js';

/**
 * Ordered Fastify plugin list registered by {@link registerMiddleware}. Order
 * is significant: `requestLifecycleMiddleware` MUST be first to own the
 * `onResponse` orchestration, and `rateLimitMiddleware` runs before
 * `organizationRlsTransactionMiddleware` so throttled requests never open a DB
 * transaction.
 */
export const middlewarePlugins = [
  // MUST be first: registers the only `onResponse` hook that orchestrates
  // RLS-settle → idempotency-cache → outbox-flush in the correct order
  // (Fastify onResponse hooks run FIFO).
  requestLifecycleMiddleware,
  compressMiddleware,
  cookieMiddleware,
  helmetMiddleware,
  corsMiddleware,
  errorHandlerMiddleware,
  responseFormatMiddleware,
  apiVersioningMiddleware,
  requestContextMiddleware,
  i18nMiddleware,
  idempotencyMiddleware,
  encryptionMiddleware,
  zodTypeProviderMiddleware,
  authMiddleware,
  tenantMiddleware,
  // The global limiter is keyed strictly on `request.ip` (see rate-limit.middleware.ts), so it
  // no longer depends on tenant resolution. It MUST stay before organizationRlsTransactionMiddleware
  // so throttled requests never open a DB transaction. tenantMiddleware stays after i18nMiddleware
  // because it throws a translated ValidationError on header/path mismatch.
  rateLimitMiddleware,
  organizationRlsTransactionMiddleware,
  requestStatementTimeoutMiddleware,
  healthMiddleware,
  httpMetricsPlugin,
  metricsMiddleware,
  shutdownMiddleware,
] as const;

/** Sequentially registers {@link middlewarePlugins} on the Fastify app; order matters. */
export async function registerMiddleware(application: FastifyInstance): Promise<void> {
  for (const plugin of middlewarePlugins) {
    await application.register(plugin);
  }
}
