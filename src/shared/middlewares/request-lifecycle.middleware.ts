import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { eventBus } from '@/core/events/event-bus.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  settleAndAwaitOrganizationRlsTransaction,
  type OrganizationRlsTransactionSettlementOutcome,
} from './organization-rls-transaction.middleware.js';
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
 * Idempotency cache writes and outbox flushes run only when settlement reports
 * `committed` or `no_transaction` (autocommit / non-org routes). Rollback and settle
 * failures release idempotency placeholders without caching 2xx responses and skip
 * `flushOnCommit` so workers never observe uncommitted writes.
 */
function mayPersistPostCommitSideEffects(
  outcome: OrganizationRlsTransactionSettlementOutcome,
): boolean {
  return outcome === 'committed' || outcome === 'no_transaction';
}

const requestLifecycleMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onResponse', async (request, reply) => {
    let settlementOutcome: OrganizationRlsTransactionSettlementOutcome = 'settle_failed';
    try {
      settlementOutcome = await settleAndAwaitOrganizationRlsTransaction(request, reply);
    } catch (error) {
      logger.warn({ error, requestId: request.id }, 'request.lifecycle.rls_settle_failed');
    }

    const persistSideEffects = mayPersistPostCommitSideEffects(settlementOutcome);

    try {
      if (persistSideEffects) {
        await idempotencyOnResponse(request, reply);
      } else {
        await idempotencyOnResponse(request, reply, { forceRelease: true });
      }
    } catch (error) {
      logger.warn({ error, requestId: request.id }, 'request.lifecycle.idempotency_failed');
    }

    if (!persistSideEffects) {
      return;
    }

    try {
      await eventBus.flushOnCommit();
    } catch (error) {
      logger.warn({ error, requestId: request.id }, 'request.lifecycle.outbox_flush_failed');
    }
  });
};

export default fp(requestLifecycleMiddleware, { name: 'request-lifecycle-middleware' });
