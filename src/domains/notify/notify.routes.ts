import type { FastifyPluginAsync } from 'fastify';
import { notificationRoutes } from './sub-domains/notification/notification.routes.js';
import { webhookRoutes } from './sub-domains/webhook/webhook.routes.js';

/**
 * Top-level Fastify plugin that mounts every notify-domain HTTP route (notifications + webhooks)
 * using services resolved from `app.notifyDomain`.
 */
export const notifyRoutesPlugin: FastifyPluginAsync = async (app) => {
  const { notifyDomain } = app;
  await app.register(notificationRoutes(notifyDomain.notificationService));
  await app.register(webhookRoutes(notifyDomain.webhookService, notifyDomain.webhookEventService));
};
