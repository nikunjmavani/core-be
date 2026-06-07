import { z } from 'zod';
import { organizationIdParamsDto } from '@/domains/tenancy/sub-domains/organization/organization.dto.js';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for the `:id` path param on `GET /organizations/:id/invitations`;
 * re-exports the shared organization id params shape.
 */
export const listMemberInvitationsParamsDto = organizationIdParamsDto;

/**
 * Zod schema for the `GET /organizations/:id/invitations` query string —
 * cursor pagination plus an `include_total=true|false` opt-in for the
 * expensive `COUNT(*)` total.
 */
export const listMemberInvitationsQueryDto = cursorPaginationSchema
  .extend({
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

/**
 * Zod schema for routes whose only path param is `invitationId` (accept and
 * decline, which are not scoped to an organization in the URL).
 */
export const memberInvitationIdParamsDto = z
  .object({
    invitationId: trimmedStringMinMax(1, 21),
  })
  .strict();

/**
 * Zod schema for routes that carry both the organization `id` and the
 * `invitationId` (cancel / resend under `/organizations/:id/invitations`).
 */
export const organizationInvitationParamsDto = organizationIdParamsDto.extend({
  invitationId: trimmedStringMinMax(1, 21),
});

/**
 * Zod schema for the `POST /organizations/:id/invitations` request body.
 * Carries only `membership_id` and `expires_in_days`; the invitee email is
 * derived server-side from the membership's actual user record and is never
 * accepted from the client. `expires_in_days` clamps to 1–365 with a 7-day
 * default.
 */
export const createMemberInvitationDto = z
  .object({
    membership_id: trimmedStringMinMax(1, 21),
    expires_in_days: z.number().int().min(1).max(365).optional().default(7),
  })
  .strict();

/**
 * Zod schema for the `POST /invitations/:invitationId/accept` request body —
 * carries the raw invitation token that is SHA-256 compared against the stored
 * `token_hash`.
 */
export const acceptMemberInvitationDto = z
  .object({
    token: trimmedStringMinMax(1, 512),
  })
  .strict();

/**
 * Zod schema for the `POST /organizations/:id/invitations/:invitationId/resend`
 * request body. Regenerates the token and pushes the expiry by the supplied
 * number of days (1–365, default 7).
 */
export const resendMemberInvitationDto = z
  .object({
    expires_in_days: z.number().int().min(1).max(365).optional().default(7),
  })
  .strict();

/** Validated body inferred from {@link createMemberInvitationDto}. */
export type CreateMemberInvitationInput = z.infer<typeof createMemberInvitationDto>;
/** Validated query inferred from {@link listMemberInvitationsQueryDto}. */
export type ListMemberInvitationsQueryInput = z.infer<typeof listMemberInvitationsQueryDto>;
/** Validated body inferred from {@link acceptMemberInvitationDto}. */
export type AcceptMemberInvitationInput = z.infer<typeof acceptMemberInvitationDto>;
/** Validated body inferred from {@link resendMemberInvitationDto}. */
export type ResendMemberInvitationInput = z.infer<typeof resendMemberInvitationDto>;
