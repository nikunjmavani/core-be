import type { FastifyPluginAsync } from 'fastify';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { TENANCY_PERMISSIONS } from '../../tenancy.permissions.js';
import type { MemberRoleService } from './member-role.service.js';
import type { MemberRolePermissionService } from './member-role-permission/member-role-permission.service.js';
import { createMemberRoleController } from './member-role.controller.js';
import { createMemberRolePermissionController } from './member-role-permission/member-role-permission.controller.js';

export interface MemberRoleRoutesDeps {
  memberRoleService: MemberRoleService;
  memberRolePermissionService: MemberRolePermissionService;
}

export function memberRoleRoutes(deps: MemberRoleRoutesDeps): FastifyPluginAsync {
  const roleController = createMemberRoleController(deps.memberRoleService);
  const permissionController = createMemberRolePermissionController(
    deps.memberRolePermissionService,
  );

  return async (app) => {
    // Member Role CRUD
    app.get<{ Params: { id: string } }>(
      '/organizations/:id/roles',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ, 'id')],
        schema: {
          summary: 'List roles',
          description:
            'Returns all roles defined in the organization. Requires ROLE_READ permission.',
          tags: ['Role'],
        },
      },
      roleController.listRoles,
    );
    app.get<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ, 'id')],
        schema: {
          summary: 'Get role',
          description: 'Returns a single role with its details. Requires ROLE_READ permission.',
          tags: ['Role'],
        },
      },
      roleController.getRole,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/roles',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
        schema: {
          summary: 'Create role',
          description:
            'Creates a new custom role in the organization. Requires ROLE_MANAGE permission.',
          tags: ['Role'],
        },
      },
      roleController.createRole,
    );
    app.patch<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
        schema: {
          summary: 'Update role',
          description:
            'Updates a role name or description. System roles cannot be modified. Requires ROLE_MANAGE permission.',
          tags: ['Role'],
        },
      },
      roleController.updateRole,
    );
    app.delete<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
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
    app.get<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ, 'id')],
        schema: {
          summary: 'List role permissions',
          description: 'Returns all permissions assigned to a role. Requires ROLE_READ permission.',
          tags: ['Role', 'Permission'],
        },
      },
      permissionController.listRolePermissions,
    );
    app.put<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
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
