import type { FastifyInstance } from 'fastify';
import requestLifecycleMiddleware from './request-lifecycle.middleware.js';
import compressMiddleware from './compress.middleware.js';
import cookieMiddleware from './cookie.middleware.js';
import helmetMiddleware from './helmet.middleware.js';
import corsMiddleware from './cors.middleware.js';
import rateLimitMiddleware from './rate-limit.middleware.js';
import errorHandlerMiddleware from './error-handler.middleware.js';
import responseFormatMiddleware from './response-format.middleware.js';
import apiVersioningMiddleware from './api-versioning.middleware.js';
import requestContextMiddleware from './request-context.middleware.js';
import i18nMiddleware from './i18n.middleware.js';
import idempotencyMiddleware from './idempotency.middleware.js';
import encryptionMiddleware from './encryption.middleware.js';
import authMiddleware from './auth.middleware.js';
import zodTypeProviderMiddleware from './zod-type-provider.middleware.js';
import tenantMiddleware from './tenant.middleware.js';
import organizationRlsTransactionMiddleware from './organization-rls-transaction.middleware.js';
import requestStatementTimeoutMiddleware from './request-statement-timeout.middleware.js';
import healthMiddleware from './health.middleware.js';
import httpMetricsPlugin from '@/infrastructure/observability/metrics/http-metrics.plugin.js';
import metricsMiddleware from './metrics.middleware.js';
import shutdownMiddleware from './shutdown.middleware.js';

const middlewarePlugins = [
  // MUST be first: registers the only `onResponse` hook that orchestrates
  // RLS-settle → idempotency-cache → outbox-flush in the correct order
  // (Fastify onResponse hooks run FIFO).
  requestLifecycleMiddleware,
  compressMiddleware,
  cookieMiddleware,
  helmetMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
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
  organizationRlsTransactionMiddleware,
  requestStatementTimeoutMiddleware,
  healthMiddleware,
  httpMetricsPlugin,
  metricsMiddleware,
  shutdownMiddleware,
] as const;

export async function registerMiddleware(application: FastifyInstance): Promise<void> {
  for (const plugin of middlewarePlugins) {
    await application.register(plugin);
  }
}
