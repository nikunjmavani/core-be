import type { FastifyPluginAsync } from 'fastify';
import { notificationRoutes } from './sub-domains/notification/notification.routes.js';
import { webhookRoutes } from './sub-domains/webhook/webhook.routes.js';

export const notifyRoutesPlugin: FastifyPluginAsync = async (app) => {
  const { notifyDomain } = app;
  await app.register(notificationRoutes(notifyDomain.notificationService));
  await app.register(webhookRoutes(notifyDomain.webhookService, notifyDomain.webhookEventService));
};
