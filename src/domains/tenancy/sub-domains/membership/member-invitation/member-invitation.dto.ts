import { z } from 'zod';
import { organizationIdParamsDto } from '@/domains/tenancy/sub-domains/organization/organization.dto.js';
import { cursorListQuerySchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedEmail, trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const listMemberInvitationsParamsDto = organizationIdParamsDto;

export const listMemberInvitationsQueryDto = cursorListQuerySchema
  .extend({
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

export const memberInvitationIdParamsDto = z
  .object({
    invitationId: trimmedStringMinMax(1, 21),
  })
  .strict();

export const organizationInvitationParamsDto = organizationIdParamsDto.extend({
  invitationId: trimmedStringMinMax(1, 21),
});

export const createMemberInvitationDto = z
  .object({
    membership_id: trimmedStringMinMax(1, 21),
    email: trimmedEmail(),
    expires_in_days: z.number().int().min(1).max(365).optional().default(7),
  })
  .strict();

export const acceptMemberInvitationDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
  })
  .strict();

export const resendMemberInvitationDto = z
  .object({
    expires_in_days: z.number().int().min(1).max(365).optional().default(7),
  })
  .strict();

export type CreateMemberInvitationInput = z.infer<typeof createMemberInvitationDto>;
export type ListMemberInvitationsQueryInput = z.infer<typeof listMemberInvitationsQueryDto>;
export type AcceptMemberInvitationInput = z.infer<typeof acceptMemberInvitationDto>;
export type ResendMemberInvitationInput = z.infer<typeof resendMemberInvitationDto>;
