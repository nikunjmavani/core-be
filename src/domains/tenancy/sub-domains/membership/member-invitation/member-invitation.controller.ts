import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import { ForbiddenError } from '@/shared/errors/index.js';
import {
  getRequestIdentifier,
  requireAuth,
  requirePrincipal,
  resolveActiveOrganizationId,
} from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { MemberInvitationService } from './member-invitation.service.js';

/**
 * Builds the HTTP handler map for organization-scoped invitation routes
 * (list/create/cancel/resend under `/organization/invitations`) and the
 * cross-org user-facing routes (`/invitations/pending`,
 * `/invitations/:invitation_id/accept`, `/invitations/:invitation_id/decline`).
 */
export function createMemberInvitationController(service: MemberInvitationService) {
  return {
    listMemberInvitations: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = resolveActiveOrganizationId(request);
      const result = await service.list({
        organization_public_id: organizationId,
        query: request.query,
      });
      return paginatedResponse(result.items, getRequestIdentifier(request), {
        per_page: result.limit,
        next: result.next_cursor,
        has_more: result.has_more,
        ...(result.total !== null ? { estimated_total: result.total } : {}),
      });
    },
    createMemberInvitation: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = resolveActiveOrganizationId(request);
      const result = await service.create(organizationId, request.body, auth.userId);
      reply.code(201);
      return successResponse(
        { invitation: result.invitation, token: result.token },
        getRequestIdentifier(request),
      );
    },
    acceptMemberInvitation: async (request: FastifyRequest, _reply: FastifyReply) => {
      // sec-T4: route now `app.authenticate`-gated; service binds the
      // invitee email to the acting user's email. API-key principals
      // cannot accept invitations (no user identity to bind to) — gate
      // explicitly with a 403.
      const auth = requirePrincipal(request);
      if (auth.kind !== 'user') {
        throw new ForbiddenError('errors:invitationEmailMismatch');
      }
      const { invitation_id: rawAcceptId } = (request.params as { invitation_id: string }) ?? {
        invitation_id: '',
      };
      // sec-new-T2: reject malformed path params before reaching the service layer.
      const invitationId = validatePublicIdParam(rawAcceptId ?? '', 'invitation_id');
      const data = await service.accept(invitationId, request.body, auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
    revokeMemberInvitation: async (request: FastifyRequest, reply: FastifyReply) => {
      requirePrincipal(request);
      const organizationId = resolveActiveOrganizationId(request);
      // sec-new-T2: reject malformed path params before reaching the service layer.
      const { invitation_id: rawRevokeId } = request.params as { invitation_id: string };
      const invitationId = validatePublicIdParam(rawRevokeId ?? '', 'invitation_id');
      await service.revoke(organizationId, invitationId);
      return reply.code(204).send();
    },
    resendInvitation: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = resolveActiveOrganizationId(request);
      // sec-new-T2: reject malformed path params before reaching the service layer.
      const { invitation_id: rawResendId } = request.params as { invitation_id: string };
      const invitationId = validatePublicIdParam(rawResendId ?? '', 'invitation_id');
      const result = await service.resend(organizationId, invitationId, request.body);
      return successResponse(
        { invitation: result.invitation, token: result.token },
        getRequestIdentifier(request),
      );
    },
    listPendingInvitations: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await service.listPendingInvitations(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
    declineInvitation: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { invitation_id: rawDeclineId } = (request.params as { invitation_id: string }) ?? {
        invitation_id: '',
      };
      // sec-new-T2: reject malformed path params before reaching the service layer.
      const invitationId = validatePublicIdParam(rawDeclineId ?? '', 'invitation_id');
      await service.decline(invitationId, auth.userId);
      return reply.code(204).send();
    },
  };
}
