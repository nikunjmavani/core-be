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

export function validateListMemberInvitationsQuery(data: unknown): ListMemberInvitationsQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listMemberInvitationsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateCreateMemberInvitation(data: unknown): CreateMemberInvitationInput {
  const result = createMemberInvitationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateAcceptMemberInvitation(data: unknown): AcceptMemberInvitationInput {
  const result = acceptMemberInvitationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateResendMemberInvitation(data: unknown): ResendMemberInvitationInput {
  const result = resendMemberInvitationDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
