import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const requestContextMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    enterOnCommitScope();
    (request as { _startAt?: number })._startAt = Date.now();
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    /**
     * Runs after organization-rls-transaction / request-statement-timeout `onResponse`
     * hooks (registered later → execute first). Dispatches transactional outbox BullMQ
     * jobs only once the request DB transaction has committed.
     */
    await eventBus.flushOnCommit();

    if (request.url.startsWith('/health')) {
      return;
    }

    const startAt = (request as { _startAt?: number })._startAt;
    const durationMs = startAt ? Date.now() - startAt : undefined;

    const routeTemplate = request.routeOptions?.url ?? request.url.split('?')[0];

    logger.info(
      {
        requestId: request.id,
        method: request.method,
        route: routeTemplate,
        statusCode: reply.statusCode,
        durationMs,
      },
      'request.complete',
    );
  });
};

export default fp(requestContextMiddleware, { name: 'request-context-middleware' });
