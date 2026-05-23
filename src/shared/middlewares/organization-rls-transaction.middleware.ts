import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import {
  decrementOrganizationRlsCheckoutCount,
  incrementOrganizationRlsCheckoutCount,
} from '@/infrastructure/database/organization-rls-checkout-counter.js';
import {
  organizationRequestDatabaseStorage,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

type OrganizationRlsTransactionCompletion = {
  resolve: () => void;
  reject: (reason: Error) => void;
};

const organizationRlsTransactionCompletions = new WeakMap<
  FastifyRequest,
  OrganizationRlsTransactionCompletion
>();

/**
 * Outer `database.transaction()` promise per request. The request lifecycle coordinator
 * awaits this so idempotency cache writes and outbox flushes only run after commit/rollback
 * has actually settled — calling `resolve()` on the inner promise only lets the transaction
 * callback return; the COMMIT still completes asynchronously.
 */
const organizationRlsTransactionOuterPromises = new WeakMap<FastifyRequest, Promise<void>>();

const organizationRlsCheckoutHeld = new WeakMap<FastifyRequest, boolean>();

function getOrganizationPublicIdFromRequest(request: FastifyRequest): string | null {
  const organizationPublicId = (request as FastifyRequest & { organizationId: string | null })
    .organizationId;
  if (
    organizationPublicId === undefined ||
    organizationPublicId === null ||
    organizationPublicId.length === 0
  ) {
    return null;
  }
  return organizationPublicId;
}

function settleOrganizationRlsTransaction(request: FastifyRequest, reply: FastifyReply): void {
  const completion = organizationRlsTransactionCompletions.get(request);
  if (!completion) {
    return;
  }
  organizationRlsTransactionCompletions.delete(request);

  const statusCode = reply.statusCode ?? 200;
  if (statusCode >= 400) {
    completion.reject(new Error(`organization_rls_transaction_abort_http_${String(statusCode)}`));
    return;
  }
  completion.resolve();
}

/**
 * Signals settlement to the in-flight RLS transaction and awaits the outer
 * `database.transaction()` promise so commit/rollback has finished before the caller
 * proceeds. Also releases the pooled checkout counter. Safe to call for non-org
 * requests (no-op when no transaction was opened).
 *
 * Intended to be invoked exclusively from the request lifecycle coordinator
 * (`request-lifecycle.middleware.ts`) — it owns the post-response ordering across RLS,
 * idempotency, and outbox flush.
 */
export async function settleAndAwaitOrganizationRlsTransaction(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  settleOrganizationRlsTransaction(request, reply);

  const outerPromise = organizationRlsTransactionOuterPromises.get(request);
  if (outerPromise !== undefined) {
    organizationRlsTransactionOuterPromises.delete(request);
    try {
      await outerPromise;
    } catch (error) {
      logger.warn(
        { error, organizationPublicId: getOrganizationPublicIdFromRequest(request) },
        'organization.rls.transaction.settle_await_error',
      );
    }
  }

  if (organizationRlsCheckoutHeld.delete(request)) {
    decrementOrganizationRlsCheckoutCount();
  }
}

/**
 * When `tenant.middleware` has set `request.organizationId`, pins every Drizzle query for
 * the rest of that HTTP request to a single pooled checkout wrapped in `BEGIN` with
 * `SET LOCAL app.current_organization_id` so Row-Level Security policies observe the
 * same GUC as the handler (fixes cross-connection RLS drift when `DATABASE_POOL_MAX` > 1).
 *
 * The outer transaction commits on `onResponse` when status < 400; 4xx/5xx roll back.
 *
 * Pool pressure: this holds one checkout for the full request — keep handlers fast; org routes
 * without X-Organization-Id use autocommit per query instead.
 *
 * Bypassed entirely when `DATABASE_RLS_SCOPED_CONTEXTS=true` (production hardening item 2). In that
 * mode services are expected to wrap their unit-of-work in `withOrganizationDatabaseContext`.
 */
const organizationRlsTransactionMiddlewarePlugin: FastifyPluginAsync = async (application) => {
  if (env.DATABASE_RLS_SCOPED_CONTEXTS) {
    logger.info(
      'organization-rls-transaction-middleware.disabled: DATABASE_RLS_SCOPED_CONTEXTS=true; using scoped withOrganizationDatabaseContext path',
    );
    return;
  }
  application.addHook('onRequest', (request: FastifyRequest, _reply, done) => {
    const organizationPublicId = getOrganizationPublicIdFromRequest(request);
    if (organizationPublicId === null) {
      done();
      return;
    }

    let hookDone = false;
    const safeDone = (error?: Error): void => {
      if (hookDone) return;
      hookDone = true;
      if (error !== undefined) {
        done(error);
        return;
      }
      done();
    };

    const statementTimeoutMs = env.DATABASE_HTTP_STATEMENT_TIMEOUT_MS;

    organizationRlsCheckoutHeld.set(request, true);
    incrementOrganizationRlsCheckoutCount();
    const outerPromise = database
      .transaction(async (transaction) => {
        await transaction.execute(
          drizzleSql`SELECT set_config('app.current_organization_id', ${organizationPublicId}, true)`,
        );
        if (statementTimeoutMs > 0) {
          await transaction.execute(
            drizzleSql`SET LOCAL statement_timeout = ${drizzleSql.raw(String(statementTimeoutMs))}`,
          );
        }

        await new Promise<void>((resolve, reject) => {
          organizationRlsTransactionCompletions.set(request, { resolve, reject });
          organizationRequestDatabaseStorage.run(
            {
              databaseHandle: transaction as unknown as RequestScopedPostgresDatabase,
              organizationPublicId,
            },
            () => {
              safeDone();
            },
          );
        });
      })
      .catch((error: unknown) => {
        organizationRlsTransactionCompletions.delete(request);
        if (!hookDone) {
          safeDone(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        logger.warn({ error }, 'organization.rls.transaction.failure_after_on_request');
      });
    organizationRlsTransactionOuterPromises.set(request, outerPromise);
  });
};

export default fp(organizationRlsTransactionMiddlewarePlugin, {
  name: 'organization-rls-transaction-middleware',
});
