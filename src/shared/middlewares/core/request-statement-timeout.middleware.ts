import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Placeholder plugin retained for middleware registration order. HTTP statement timeouts are
 * enforced at the postgres.js connection level via `DATABASE_HTTP_STATEMENT_TIMEOUT_MS`
 * (see `buildPostgresOptions` in `connection.ts`).
 */
const requestStatementTimeoutMiddlewarePlugin: FastifyPluginAsync = async () => {
  /* no-op — connection-level statement_timeout */
};

export default fp(requestStatementTimeoutMiddlewarePlugin, {
  name: 'request-statement-timeout-middleware',
});
