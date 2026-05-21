import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  MODERATE_AUTHED_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
  STRICT_PUBLIC_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit-presets.constants.js';
import { listLimitQuerySchema } from '@/shared/utils/http/pagination.util.js';
import type { MembershipService } from './membership.service.js';
import type { MemberInvitationService } from './member-invitation/member-invitation.service.js';
import { createMembershipController } from './membership.controller.js';
import { createMemberInvitationController } from './member-invitation/member-invitation.controller.js';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { TENANCY_PERMISSIONS } from '../../tenancy.permissions.js';

export interface MembershipRoutesDeps {
  membershipService: MembershipService;
  memberInvitationService: MemberInvitationService;
}

export function membershipRoutes(deps: MembershipRoutesDeps): FastifyPluginAsync {
  const membershipController = createMembershipController(deps.membershipService);
  const invitationController = createMemberInvitationController(deps.memberInvitationService);

  return async (app) => {
    // Membership CRUD
    app.get<{ Params: { id: string } }>(
      '/organizations/:id/memberships',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_READ, 'id')],
      },
      membershipController.listMemberships,
    );
    app.get<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_READ, 'id')],
      },
      membershipController.getMembership,
    );
    app.get<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_READ, 'id')],
      },
      membershipController.getMembershipPermissions,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/memberships',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE, 'id')],
      },
      membershipController.createMembership,
    );
    app.patch<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE, 'id')],
      },
      membershipController.updateMembership,
    );
    app.delete<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE, 'id')],
      },
      membershipController.deleteMembership,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/leave',
      { onRequest: [app.authenticate] },
      membershipController.leaveOrganization,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/transfer-ownership',
      { onRequest: [app.authenticate] },
      membershipController.transferOwnership,
    );

    // Member Invitations
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/organizations/:id/invitations',
      {
        schema: { querystring: listLimitQuerySchema },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
      },
      invitationController.listMemberInvitations,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/invitations',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
        ...MODERATE_AUTHED_RATE_LIMIT,
      },
      invitationController.createMemberInvitation,
    );
    app.post<{ Params: { invitationId: string } }>(
      '/invitations/:invitationId/accept',
      STRICT_PUBLIC_RATE_LIMIT,
      invitationController.acceptMemberInvitation,
    );
    app.delete<{ Params: { id: string; invitationId: string } }>(
      '/organizations/:id/invitations/:invitationId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
      },
      invitationController.revokeMemberInvitation,
    );
    app.post<{ Params: { id: string; invitationId: string } }>(
      '/organizations/:id/invitations/:invitationId/resend',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
        ...STRICT_AUTHED_RATE_LIMIT,
      },
      invitationController.resendInvitation,
    );
    app.get(
      '/invitations/pending',
      { onRequest: [app.authenticate] },
      invitationController.listPendingInvitations,
    );
    app.post<{ Params: { invitationId: string } }>(
      '/invitations/:invitationId/decline',
      { onRequest: [app.authenticate] },
      invitationController.declineInvitation,
    );
  };
}
