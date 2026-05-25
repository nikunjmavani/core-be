import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { eventBus } from '@/core/events/event-bus.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { settleAndAwaitOrganizationRlsTransaction } from './organization-rls-transaction.middleware.js';
import { idempotencyOnResponse } from './idempotency.middleware.js';

/**
 * Request lifecycle coordinator.
 *
 * Owns the post-response ordering for write-side effects so they observe a settled DB
 * transaction. Fastify `onResponse` hooks run FIFO; this plugin is registered FIRST in
 * `middlewarePlugins` so its hook fires before any other `onResponse` and explicitly
 * sequences the three steps that previously raced:
 *
 *   1. Settle the per-request RLS transaction and AWAIT commit/rollback.
 *   2. Persist the idempotency cache entry (only meaningful after commit).
 *   3. Flush the on-commit outbox (enqueue BullMQ side-effect jobs).
 *
 * Each step is independently guarded so a failure in one does not skip later steps; the
 * RLS settle is the only step whose outcome influences correctness of the others, and any
 * error there is already logged inside `settleAndAwaitOrganizationRlsTransaction`.
 */
const requestLifecycleMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onResponse', async (request, reply) => {
    try {
      await settleAndAwaitOrganizationRlsTransaction(request, reply);
    } catch (error) {
      logger.warn({ error, requestId: request.id }, 'request.lifecycle.rls_settle_failed');
    }

    try {
      await idempotencyOnResponse(request, reply);
    } catch (error) {
      logger.warn({ error, requestId: request.id }, 'request.lifecycle.idempotency_failed');
    }

    try {
      await eventBus.flushOnCommit();
    } catch (error) {
      logger.warn({ error, requestId: request.id }, 'request.lifecycle.outbox_flush_failed');
    }
  });
};

export default fp(requestLifecycleMiddleware, { name: 'request-lifecycle-middleware' });
