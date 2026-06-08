import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  EXPENSIVE_AUTHED_RATE_LIMIT,
  MODERATE_AUTHED_RATE_LIMIT,
  ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
  STRICT_PUBLIC_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { rejectLegacyPagePagination } from '@/shared/utils/http/pagination.util.js';
import type { MembershipService } from './membership.service.js';
import type { MemberInvitationService } from './member-invitation/member-invitation.service.js';
import { listMemberInvitationsQueryDto } from './member-invitation/member-invitation.dto.js';
import { createMembershipController } from './membership.controller.js';
import { createMemberInvitationController } from './member-invitation/member-invitation.controller.js';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';

/** Services required to wire the membership and member-invitation routes. */
export interface MembershipRoutesDeps {
  membershipService: MembershipService;
  memberInvitationService: MemberInvitationService;
}

/**
 * Fastify plugin that registers organization membership routes (list, get,
 * create, update, delete, plus self-service leave / transfer-ownership) and
 * the member-invitation routes (org-scoped create/list/cancel/resend plus the
 * cross-org `/invitations/...` user-facing pending/accept/decline endpoints).
 * Permission-gated routes are protected with
 * `requireOrganizationPermission(MEMBERSHIP_*|INVITATION_MANAGE, 'id')`; public
 * accept has only a strict rate limit.
 */
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
        schema: {
          summary: 'List memberships',
          description:
            'Returns all memberships in the organization with their roles. Requires MEMBERSHIP_READ permission.',
          tags: ['Membership'],
        },
      },
      membershipController.listMemberships,
    );
    app.get<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_READ, 'id')],
        schema: {
          summary: 'Get membership',
          description:
            'Returns a single membership including user details and role. Requires MEMBERSHIP_READ permission.',
          tags: ['Membership'],
        },
      },
      membershipController.getMembership,
    );
    app.get<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId/permissions',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_READ, 'id')],
        schema: {
          summary: 'Get membership permissions',
          description:
            'Returns all effective permissions for a membership (from role). Requires MEMBERSHIP_READ permission.',
          tags: ['Membership'],
        },
      },
      membershipController.getMembershipPermissions,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/memberships',
      {
        config: { idempotencyRequired: true },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE, 'id')],
        schema: {
          summary: 'Create membership',
          description:
            'Adds a user as a member of the organization with a specific role. Requires MEMBERSHIP_MANAGE permission.',
          tags: ['Membership'],
        },
      },
      membershipController.createMembership,
    );
    app.patch<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE, 'id')],
        schema: {
          summary: 'Update membership',
          description:
            'Updates a membership status (e.g. suspend or activate). Requires MEMBERSHIP_MANAGE permission.',
          tags: ['Membership'],
        },
      },
      membershipController.updateMembership,
    );
    app.delete<{ Params: { id: string; membershipId: string } }>(
      '/organizations/:id/memberships/:membershipId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE, 'id')],
        schema: {
          summary: 'Remove membership',
          description:
            'Removes a member from the organization. Requires MEMBERSHIP_MANAGE permission.',
          tags: ['Membership'],
        },
      },
      membershipController.deleteMembership,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/leave',
      {
        // sec-r4-I3: self-service exit revokes the caller's membership row.
        // Without a cap, a session-token holder (or compromised script) could
        // loop the endpoint against arbitrary org ids to probe membership
        // existence by status code. Cap at the moderate-authed tier (30/60s).
        ...MODERATE_AUTHED_RATE_LIMIT,
        onRequest: [app.authenticate],
        schema: {
          summary: 'Leave organization',
          description:
            'Allows the authenticated user to leave the organization. Owners cannot leave without transferring ownership first.',
          tags: ['Membership'],
        },
      },
      membershipController.leaveOrganization,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/transfer-ownership',
      {
        // sec-r4-I3: ownership transfer is effectively irreversible (no
        // automatic recovery if the new owner is malicious). Cap at the
        // expensive-authed tier (5 req / 5 min) so a hijacked owner session
        // cannot pivot multiple tenants in rapid succession. Preserve
        // idempotencyRequired by merging into a single config object.
        config: { idempotencyRequired: true, ...EXPENSIVE_AUTHED_RATE_LIMIT.config },
        onRequest: [app.authenticate],
        schema: {
          summary: 'Transfer organization ownership',
          description:
            'Transfers ownership of the organization to another member. Only the current owner can perform this action.',
          tags: ['Membership'],
        },
      },
      membershipController.transferOwnership,
    );

    // Member Invitations
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/organizations/:id/invitations',
      {
        schema: {
          summary: 'List invitations',
          description:
            'Returns all pending invitations for the organization. Requires INVITATION_MANAGE permission.',
          tags: ['Membership', 'Invitation'],
          querystring: listMemberInvitationsQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
      },
      invitationController.listMemberInvitations,
    );
    app.post<{ Params: { id: string } }>(
      '/organizations/:id/invitations',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
        config: { ...MODERATE_AUTHED_RATE_LIMIT.config, idempotencyRequired: true },
        schema: {
          summary: 'Create invitation',
          description:
            'Sends an invitation email to join the organization. Requires INVITATION_MANAGE permission.',
          tags: ['Membership', 'Invitation'],
        },
      },
      invitationController.createMemberInvitation,
    );
    app.post<{ Params: { invitationId: string } }>(
      '/invitations/:invitationId/accept',
      {
        // sec-T4: accept now requires authentication and (in the service)
        // an invitee-email match. The previous unauthenticated route let
        // anyone who got hold of the invitation URL flip the victim's
        // pending membership to ACTIVE without the victim's interaction.
        onRequest: [app.authenticate],
        ...STRICT_PUBLIC_RATE_LIMIT,
        schema: {
          summary: 'Accept invitation',
          description:
            "Accepts a pending invitation using the invitation token. Requires authentication; the authenticated user's email must match the invitee email on the invitation. Creates a membership for the user.",
          tags: ['Membership', 'Invitation'],
        },
      },
      invitationController.acceptMemberInvitation,
    );
    app.delete<{ Params: { id: string; invitationId: string } }>(
      '/organizations/:id/invitations/:invitationId',
      {
        // sec-r4-I3: invitation revocation is an org-scoped admin mutation.
        // Cap per (org, actor) so a single admin cannot churn invitations and
        // a cross-tenant probe cannot exhaust a victim org's bucket.
        ...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT,
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
        schema: {
          summary: 'Cancel invitation',
          description: 'Cancels a pending invitation. Requires INVITATION_MANAGE permission.',
          tags: ['Membership', 'Invitation'],
        },
      },
      invitationController.revokeMemberInvitation,
    );
    app.post<{ Params: { id: string; invitationId: string } }>(
      '/organizations/:id/invitations/:invitationId/resend',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.INVITATION_MANAGE, 'id')],
        ...STRICT_AUTHED_RATE_LIMIT,
        schema: {
          summary: 'Resend invitation',
          description:
            'Resends the invitation email with a new expiry. Requires INVITATION_MANAGE permission.',
          tags: ['Membership', 'Invitation'],
        },
      },
      invitationController.resendInvitation,
    );
    app.get(
      '/invitations/pending',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'List my pending invitations',
          description:
            'Returns all pending invitations for the authenticated user across all organizations.',
          tags: ['Membership', 'Invitation'],
        },
      },
      invitationController.listPendingInvitations,
    );
    app.post<{ Params: { invitationId: string } }>(
      '/invitations/:invitationId/decline',
      {
        // sec-r4-I3: decline targets a single invitation row by id; without a
        // cap a hijacked session could probe invitation existence by 404
        // vs 204 across enumerated ids. Cap at the moderate-authed tier.
        ...MODERATE_AUTHED_RATE_LIMIT,
        onRequest: [app.authenticate],
        schema: {
          summary: 'Decline invitation',
          description: 'Declines a pending invitation. The invitation is marked as declined.',
          tags: ['Membership', 'Invitation'],
        },
      },
      invitationController.declineInvitation,
    );
  };
}
