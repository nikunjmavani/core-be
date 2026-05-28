import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import {
  acceptMemberInvitationDto,
  createMemberInvitationDto,
  listMemberInvitationsQueryDto,
  resendMemberInvitationDto,
  type AcceptMemberInvitationInput,
  type CreateMemberInvitationInput,
  type ListMemberInvitationsQueryInput,
  type ResendMemberInvitationInput,
} from './member-invitation.dto.js';

/**
 * Validates the `GET /organizations/:id/invitations` query string. Rejects
 * legacy page-number pagination first, then parses against
 * {@link listMemberInvitationsQueryDto}.
 */
export function validateListMemberInvitationsQuery(data: unknown): ListMemberInvitationsQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listMemberInvitationsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Validates a `POST /organizations/:id/invitations` body against
 * {@link createMemberInvitationDto}, throwing
 * `ValidationError('errors:invalidInput')` with per-field details on failure.
 */
export function validateCreateMemberInvitation(data: unknown): CreateMemberInvitationInput {
  const result = createMemberInvitationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Validates a `POST /invitations/:invitationId/accept` body against
 * {@link acceptMemberInvitationDto}; the parsed `token` is then SHA-256
 * compared against the stored `token_hash` by the service.
 */
export function validateAcceptMemberInvitation(data: unknown): AcceptMemberInvitationInput {
  const result = acceptMemberInvitationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Validates a `POST /organizations/:id/invitations/:invitationId/resend` body
 * against {@link resendMemberInvitationDto}.
 */
export function validateResendMemberInvitation(data: unknown): ResendMemberInvitationInput {
  const result = resendMemberInvitationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
