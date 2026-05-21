import { ValidationError } from '@/shared/errors/index.js';
import {
  createMemberInvitationDto,
  acceptMemberInvitationDto,
  resendMemberInvitationDto,
  type CreateMemberInvitationInput,
  type AcceptMemberInvitationInput,
  type ResendMemberInvitationInput,
} from './member-invitation.dto.js';

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
