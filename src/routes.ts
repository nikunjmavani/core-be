import type { FastifyInstance } from 'fastify';
import { getEnv } from '@/shared/config/env.config.js';
import { registerQueueDashboard } from '@/infrastructure/queue/queue-dashboard.js';
import {
  buildPublicApiPrefix,
  PUBLIC_API_VERSION_SEGMENT_V1,
} from '@/shared/utils/http/api-versioning.util.js';
import { domainContainersPlugin } from '@/domains/domain-containers.plugin.js';
import { auditRoutesPlugin } from '@/domains/audit/audit.routes.js';
import { authRoutesPlugin } from '@/domains/auth/auth.routes.js';
import { userRoutesPlugin } from '@/domains/user/user.routes.js';
import { tenancyRoutesPlugin } from '@/domains/tenancy/tenancy.routes.js';
import { billingRoutesPlugin } from '@/domains/billing/billing.routes.js';
import { notifyRoutesPlugin } from '@/domains/notify/notify.routes.js';
import { uploadRoutesPlugin } from '@/domains/upload/upload.routes.js';

/**
 * Central route registration. Domain services are decorated on the Fastify instance
 * via `domainContainersPlugin`; route plugins read `application.*Domain` from containers.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(domainContainersPlugin);

  const apiV1 = buildPublicApiPrefix(PUBLIC_API_VERSION_SEGMENT_V1);

  await app.register(auditRoutesPlugin, { prefix: `${apiV1}/audit` });
  await app.register(authRoutesPlugin, { prefix: `${apiV1}/auth` });
  await app.register(userRoutesPlugin, { prefix: `${apiV1}/users` });
  await app.register(tenancyRoutesPlugin, { prefix: `${apiV1}/tenancy` });
  await app.register(billingRoutesPlugin, { prefix: `${apiV1}/billing` });
  await app.register(notifyRoutesPlugin, { prefix: `${apiV1}/notify` });
  await app.register(uploadRoutesPlugin, { prefix: `${apiV1}/uploads` });

  if (getEnv().ENABLE_QUEUE_DASHBOARD) {
    await registerQueueDashboard(app, { auditService: app.auditDomain.auditService });
  }
}
