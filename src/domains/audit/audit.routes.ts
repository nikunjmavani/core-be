import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GLOBAL_ROLES } from '@/shared/constants/index.js';
import { requireRole } from '@/shared/utils/auth/authorization.util.js';
import { createAuditController } from './audit.controller.js';

export const auditRoutesPlugin: FastifyPluginAsync = async (app) => {
  const controller = createAuditController(app.auditDomain.auditService);
  const zodApplication = app.withTypeProvider<ZodTypeProvider>();

  zodApplication.get(
    '/logs',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
    },
    controller.listLogs,
  );
};
