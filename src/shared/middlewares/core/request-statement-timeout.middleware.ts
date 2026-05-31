import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import {
  getOrganizationRequestDatabaseSession,
  organizationRequestDatabaseStorage,
  type RequestScopedPostgresDatabase,
} from '@/infrastructure/database/contexts/request-database.context.js';
import { env } from '@/shared/config/env.config.js';

type RequestStatementTimeoutCompletion = {
  resolve: () => void;
  reject: (reason: Error) => void;
};

const requestStatementTimeoutCompletions = new WeakMap<
  FastifyRequest,
  RequestStatementTimeoutCompletion
>();

function settleRequestStatementTimeoutTransaction(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const completion = requestStatementTimeoutCompletions.get(request);
  if (!completion) {
    return;
  }
  requestStatementTimeoutCompletions.delete(request);

  const statusCode = reply.statusCode ?? 200;
  if (statusCode >= 400) {
    completion.reject(new Error(`request_statement_timeout_abort_http_${String(statusCode)}`));
    return;
  }
  completion.resolve();
}

/**
 * Pins non-org HTTP requests to a short-lived transaction with `SET LOCAL statement_timeout`
 * when org RLS middleware did not already open a pinned checkout.
 *
 * Bypassed entirely when `DATABASE_RLS_SCOPED_CONTEXTS=true` (production hardening item 2). In that
 * mode `statement_timeout` is enforced at the postgres.js connection level via
 * `DATABASE_HTTP_STATEMENT_TIMEOUT_MS` so no per-request transaction is required.
 */
const requestStatementTimeoutMiddlewarePlugin: FastifyPluginAsync = async (application) => {
  if (env.DATABASE_RLS_SCOPED_CONTEXTS) {
    return;
  }
  application.addHook('onRequest', (request: FastifyRequest, _reply, done) => {
    if (
      request.url.startsWith('/livez') ||
      request.url.startsWith('/readyz') ||
      request.url === '/metrics'
    ) {
      done();
      return;
    }

    if (getOrganizationRequestDatabaseSession() !== undefined) {
      done();
      return;
    }

    const organizationPublicId = (request as FastifyRequest & { organizationId?: string | null })
      .organizationId;
    if (
      organizationPublicId !== undefined &&
      organizationPublicId !== null &&
      organizationPublicId.length > 0
    ) {
      done();
      return;
    }

    const statementTimeoutMs = env.DATABASE_HTTP_STATEMENT_TIMEOUT_MS;
    if (statementTimeoutMs <= 0) {
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

    void database
      .transaction(async (transaction) => {
        await transaction.execute(
          drizzleSql`SET LOCAL statement_timeout = ${drizzleSql.raw(String(statementTimeoutMs))}`,
        );

        await new Promise<void>((resolve, reject) => {
          requestStatementTimeoutCompletions.set(request, { resolve, reject });
          organizationRequestDatabaseStorage.run(
            {
              databaseHandle: transaction as unknown as RequestScopedPostgresDatabase,
              organizationPublicId: '',
            },
            () => {
              safeDone();
            },
          );
        });
      })
      .catch((error: unknown) => {
        requestStatementTimeoutCompletions.delete(request);
        if (!hookDone) {
          safeDone(error instanceof Error ? error : new Error(String(error)));
        }
      });
  });

  application.addHook('onResponse', (request: FastifyRequest, reply, done) => {
    try {
      settleRequestStatementTimeoutTransaction(request, reply);
    } catch (error: unknown) {
      done(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    done();
  });
};

export default fp(requestStatementTimeoutMiddlewarePlugin, {
  name: 'request-statement-timeout-middleware',
});
