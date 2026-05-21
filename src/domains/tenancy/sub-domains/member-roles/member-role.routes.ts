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
      },
      roleController.listRoles,
    );
    app.get<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ, 'id')],
      },
      roleController.getRole,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/roles',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
      },
      roleController.createRole,
    );
    app.patch<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
      },
      roleController.updateRole,
    );
    app.delete<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
      },
      roleController.deleteRole,
    );

    // Member Role Permissions
    app.get<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_READ, 'id')],
      },
      permissionController.listRolePermissions,
    );
    app.put<{ Params: { id: string; roleId: string } }>(
      '/organizations/:id/roles/:roleId/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ROLE_MANAGE, 'id')],
      },
      permissionController.putRolePermissions,
    );
  };
}
