import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
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

/**
 * Validates a `POST /organization/memberships` body against
 * {@link createMembershipDto}; throws `ValidationError('errors:invalidInput')`
 * with per-field details on failure.
 */
export function validateCreateMembership(data: unknown): CreateMembershipInput {
  return parseWithSchema(createMembershipDto, data);
}

/**
 * Validates a `PATCH /organization/memberships/:membership_id` body
 * against {@link updateMembershipDto}; throws
 * `ValidationError('errors:invalidInput')` on failure.
 */
export function validateUpdateMembership(data: unknown): UpdateMembershipInput {
  return parseWithSchema(updateMembershipDto, data);
}

/**
 * Validates the `GET /organization/memberships` query string. Rejects
 * legacy page-number pagination first, then parses against
 * {@link listMembershipsQueryDto}.
 */
export function validateListMembershipsQuery(data: unknown): ListMembershipsQueryInput {
  return parseCursorPaginatedQuery(
    listMembershipsQueryDto,
    data,
    'errors:validation.invalidPagination',
  );
}

/**
 * Validates a `POST /organization/transfer-ownership` body against
 * {@link transferOwnershipDto}; throws `ValidationError('errors:invalidInput')`
 * on failure.
 */
export function validateTransferOwnership(data: unknown): TransferOwnershipInput {
  return parseWithSchema(transferOwnershipDto, data);
}
