import type { FastifyPluginAsync } from 'fastify';
import { ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import type { MemberRoleService } from './member-role.service.js';
import type { MemberRolePermissionService } from './member-role-permission/member-role-permission.service.js';
import { createMemberRoleController } from './member-role.controller.js';
import { createMemberRolePermissionController } from './member-role-permission/member-role-permission.controller.js';

/** Services required to wire the member-role and role-permission routes. */
export interface MemberRoleRoutesDeps {
  memberRoleService: MemberRoleService;
  memberRolePermissionService: MemberRolePermissionService;
}

/**
 * Fastify plugin that registers the organization role CRUD routes plus the
 * nested `:role_id/permissions` listing and replacement endpoints. Every route
 * requires authentication and a `ROLE_READ` or `ROLE_MANAGE` organization
 * permission resolved against the `:id` path param.
 */
export function memberRoleRoutes(deps: MemberRoleRoutesDeps): FastifyPluginAsync {
  const roleController = createMemberRoleController(deps.memberRoleService);
  const permissionController = createMemberRolePermissionController(
    deps.memberRolePermissionService,
  );

  return async (app) => {
    // Member Role CRUD
    app.get<{ Params: { organization_id: string } }>(
      '/organizations/:organization_id/roles',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ)],
        schema: {
          summary: 'List roles',
          description:
            'Returns all roles defined in the organization. Requires ROLE_READ permission.',
          tags: ['Role'],
        },
      },
      roleController.listRoles,
    );
    app.get<{ Params: { organization_id: string; role_id: string } }>(
      '/organizations/:organization_id/roles/:role_id',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ)],
        schema: {
          summary: 'Get role',
          description: 'Returns a single role with its details. Requires ROLE_READ permission.',
          tags: ['Role'],
        },
      },
      roleController.getRole,
    );
    app.post<{ Params: { organization_id: string } }>(
      '/organizations/:organization_id/roles',
      {
        // sec-r5-ratelimit-dos-2: per (org, actor) cap on custom-role creation
        // so an Admin-role-holder cannot churn unbounded role rows. Parity with
        // sec-r4-I2 / sec-r4-I3 on every other org-scoped mutation. The
        // sec-r4-D4 .limit(256) on `findByRoleId` already caps per-role read
        // memory; this caps the rate at which new rows can be created.
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE)],
        schema: {
          summary: 'Create role',
          description:
            'Creates a new custom role in the organization. Requires ROLE_MANAGE permission.',
          tags: ['Role'],
        },
      },
      roleController.createRole,
    );
    app.patch<{ Params: { organization_id: string; role_id: string } }>(
      '/organizations/:organization_id/roles/:role_id',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE)],
        schema: {
          summary: 'Update role',
          description:
            'Updates a role name or description. System roles cannot be modified. Requires ROLE_MANAGE permission.',
          tags: ['Role'],
        },
      },
      roleController.updateRole,
    );
    app.delete<{ Params: { organization_id: string; role_id: string } }>(
      '/organizations/:organization_id/roles/:role_id',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE)],
        schema: {
          summary: 'Delete role',
          description:
            'Deletes a custom role. System roles cannot be deleted. Members with this role must be reassigned first. Requires ROLE_MANAGE permission.',
          tags: ['Role'],
        },
      },
      roleController.deleteRole,
    );

    // Member Role Permissions
    app.get<{ Params: { organization_id: string; role_id: string } }>(
      '/organizations/:organization_id/roles/:role_id/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ)],
        schema: {
          summary: 'List role permissions',
          description: 'Returns all permissions assigned to a role. Requires ROLE_READ permission.',
          tags: ['Role', 'Permission'],
        },
      },
      permissionController.listRolePermissions,
    );
    app.put<{ Params: { organization_id: string; role_id: string } }>(
      '/organizations/:organization_id/roles/:role_id/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE)],
        schema: {
          summary: 'Replace role permissions',
          description:
            'Replaces all permissions for a role with the provided set. Requires ROLE_MANAGE permission.',
          tags: ['Role', 'Permission'],
        },
      },
      permissionController.putRolePermissions,
    );
  };
}
