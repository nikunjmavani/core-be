import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
import {
  createMembershipDto,
  updateMembershipDto,
  listMembershipsQueryDto,
  transferOwnershipDto,
} from './membership.dto.js';
import type {
  CreateMembershipInput,
  UpdateMembershipInput,
  ListMembershipsQueryInput,
  TransferOwnershipInput,
} from './membership.dto.js';

export function validateCreateMembership(data: unknown): CreateMembershipInput {
  const result = createMembershipDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateUpdateMembership(data: unknown): UpdateMembershipInput {
  const result = updateMembershipDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateListMembershipsQuery(data: unknown): ListMembershipsQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listMembershipsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:validation.invalidPagination',
      undefined,
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

export function validateTransferOwnership(data: unknown): TransferOwnershipInput {
  const result = transferOwnershipDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
