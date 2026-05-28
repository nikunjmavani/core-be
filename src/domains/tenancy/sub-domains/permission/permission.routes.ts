import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PermissionService } from './permission.service.js';
import { createPermissionController } from './permission.controller.js';

/** Services required to wire the global permission catalog route. */
export interface PermissionRoutesDeps {
  permissionService: PermissionService;
}

/**
 * Fastify plugin that registers `GET /permissions`, the authenticated
 * read-only catalog of every permission code that may be assigned to a role.
 * The response is cacheable; the handler attaches catalog cache headers.
 */
export function permissionRoutes(deps: PermissionRoutesDeps): FastifyPluginAsync {
  const permissionController = createPermissionController(deps.permissionService);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/permissions',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'List all permissions',
          description:
            'Returns the complete list of available permissions that can be assigned to roles.',
          tags: ['Permission'],
        },
      },
      permissionController.listPermissions,
    );
  };
}
