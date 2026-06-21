import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import {
  acceptMemberInvitationDto,
  resendMemberInvitationDto,
  type AcceptMemberInvitationInput,
  type ResendMemberInvitationInput,
} from './member-invitation.dto.js';

/**
 * Validates a `POST /invitations/:invitation_id/accept` body against
 * {@link acceptMemberInvitationDto}; the parsed `token` is then SHA-256
 * compared against the stored `token_hash` by the service.
 */
export function validateAcceptMemberInvitation(data: unknown): AcceptMemberInvitationInput {
  return parseWithSchema(acceptMemberInvitationDto, data);
}

/**
 * Validates a `POST /organization/invitations/:invitation_id/resend` body
 * against {@link resendMemberInvitationDto}.
 */
export function validateResendMemberInvitation(data: unknown): ResendMemberInvitationInput {
  return parseWithSchema(resendMemberInvitationDto, data);
}
