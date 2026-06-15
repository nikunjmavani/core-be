import {
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { MemberInvitationRepository } from './member-invitation.repository.js';
import type { MemberInvitationOutput, MemberInvitationRow } from './member-invitation.types.js';
import {
  validateCreateMemberInvitation,
  validateAcceptMemberInvitation,
  validateListMemberInvitationsQuery,
  validateListPendingMemberInvitationsQuery,
  validateResendMemberInvitation,
} from './member-invitation.validator.js';
import { serializeMemberInvitation } from './member-invitation.serializer.js';
import { hashInvitationToken, generateInvitationToken } from './member-invitation.token.js';
import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { buildDomainEvent, eventBus } from '@/core/events/event-bus.js';
import {
  MEMBER_INVITATION_EVENT,
  type MemberInvitationEmailPayload,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.events.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const MEMBER_INVITATION_RESOURCE = 'Member invitation';

function assertInvitationAcceptable(row: MemberInvitationRow, now: Date): void {
  if (row.revoked_at) {
    throw new ValidationError('errors:validation.invitationRevoked', undefined, {});
  }
  if (row.accepted_at) {
    throw new ValidationError('errors:validation.invitationAlreadyAccepted', undefined, {});
  }
  if (now > row.expires_at) {
    throw new ValidationError('errors:validation.invitationExpired', undefined, {});
  }
}

function throwInvitationAcceptFailure(current: MemberInvitationRow | null, now: Date): never {
  if (!current) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
  assertInvitationAcceptable(current, now);
  throw new ValidationError('errors:validation.invalidToken', undefined, {
    token: ['Invalid or expired'],
  });
}

/**
 * Inputs to {@link MemberInvitationService.list}: the organization to scope
 * to plus the raw (unvalidated) query string carrying cursor pagination and
 * the optional `include_total` flag.
 *
 * @remarks
 * - **Algorithm:** the service validates `query` via the listing DTO, applies
 *   the cursor + limit, and joins through `MemberInvitationRepository`.
 * - **Failure modes:** invalid query shapes throw `ValidationError`; a missing
 *   organization throws `NotFoundError`.
 * - **Side effects:** none — read-only path.
 * - **Notes:** `query` is intentionally `unknown` so the boundary parses with
 *   Zod once inside the service.
 */
export interface MemberInvitationListOptions {
  organization_public_id: string;
  query: unknown;
}

/**
 * Optional per-command context for invitation create/resend.
 *
 * @remarks
 * - **Notes:** `requestId` propagates the originating HTTP request id into the
 *   post-commit mail dispatch so the durable Redis commit-dispatch entry
 *   survives a process crash; omit it on non-HTTP callers (the in-memory
 *   onCommit fallback is used instead).
 */
export interface MemberInvitationCommandOptions {
  requestId?: string;
}

/**
 * One cursor-paginated page of the caller's cross-organization pending
 * invitations returned by {@link MemberInvitationService.listPendingInvitations}.
 *
 * @remarks
 * - **Notes:** `next_cursor` is an opaque keyset cursor (null on the last page);
 *   `has_more` reflects whether a further page exists. `limit` echoes the
 *   effective page size after DTO defaults/clamping.
 */
export interface PendingMemberInvitationListResult {
  items: MemberInvitationOutput[];
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Application service for organization-member invitations: create, list,
 * accept, decline, resend, and revoke.
 *
 * @remarks
 * - **Algorithm:** invitations carry a single-use opaque token. On create/resend
 *   {@link generateInvitationToken} produces a 64-char hex secret; only the
 *   SHA-256 hash from {@link hashInvitationToken} is persisted as `token_hash`.
 *   Org-scoped methods run inside {@link withOrganizationDatabaseContext} so
 *   RLS sees the right `app.current_organization_id`. Public/user-facing
 *   accept and decline routes have no org context up front — they call the
 *   SECURITY DEFINER lookup `lookupOrganizationByInvitationPublicId` to
 *   resolve the owning org, then wrap the actual UPDATE in
 *   `withOrganizationDatabaseContext`.
 * - **Failure modes:** `NotFoundError` for missing org/membership/invitation;
 *   `ValidationError` (i18n keys `errors:validation.invalidToken`,
 *   `invitationRevoked`, `invitationAlreadyAccepted`, `invitationExpired`,
 *   `errors:disposableEmail`) for state and input violations;
 *   `ForbiddenError('errors:declineOwnInvitationOnly')` when a user tries to
 *   decline somebody else's invitation; `ConfigurationError` if `UserService`
 *   is not wired by the container (required for `create`, `listPendingInvitations`,
 *   `decline`, and `accept`).
 * - **Side effects:** writes to `tenancy.member_invitations`; `accept`
 *   additionally activates the linked `tenancy.memberships` row
 *   (`status = 'ACTIVE'`, `joined_at = now()`) in the same transaction and
 *   purges the member's Redis permission cache so access is granted
 *   immediately. Emits {@link MEMBER_INVITATION_EVENT.CREATED} / `RESENT` on
 *   the in-process event bus, which the invitation email handler turns into a
 *   mail-outbox row dispatched on commit. The raw token is delivered **only**
 *   through the outgoing invitation email — it is never returned in any HTTP
 *   response (R1 / TEN-32 / TEN-34). Create/resend use `emitStrict` so a failed
 *   outbox write rolls back the whole org transaction (which already wraps the
 *   invitation INSERT and the outbox INSERT), making token issuance and email
 *   delivery atomic (R2): the caller never receives success with a rotated token
 *   but no email.
 * - **Notes:** invitations have mutually-exclusive terminal states
 *   (`accepted_at` vs `revoked_at`); resend regenerates the token and pushes
 *   `expires_at`. {@link listPendingInvitations} is intentionally
 *   cross-organization (a user may have invites from many orgs); decline is
 *   modeled as a revoke from the user's side and rejected if the email does
 *   not match the authenticated user.
 */
export class MemberInvitationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly invitationRepository: MemberInvitationRepository,
    private readonly userService?: UserService,
  ) {}

  async list(options: MemberInvitationListOptions): Promise<{
    items: MemberInvitationOutput[];
    total: number | null;
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  }> {
    const { organization_public_id } = options;
    const parsed = validateListMemberInvitationsQuery(options.query);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const result = await this.invitationRepository.findByOrganizationId(
        organization.id,
        omitUndefined({
          after: parsed.after,
          limit: parsed.limit,
          include_total: parsed.include_total === 'true',
        }),
      );
      type RowWithPublicId = (typeof result.items)[number] & { membership_public_id: string };
      return {
        ...result,
        items: result.items.map((row) =>
          serializeMemberInvitation(row, (row as RowWithPublicId).membership_public_id),
        ),
      };
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    invited_by_user_public_id: string,
    options?: MemberInvitationCommandOptions,
  ): Promise<MemberInvitationOutput> {
    const parsed = validateCreateMemberInvitation(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      // Capability matrix: a PERSONAL organization is single-member by definition — it cannot
      // issue invitations. Collaboration requires a TEAM organization.
      if (organization.type === 'PERSONAL') {
        throw new ConflictError('errors:personalOrganizationNoMembers');
      }
      const membership = await this.membershipRepository.findByPublicId(
        parsed.membership_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      const inviterId =
        await this.organizationRepository.resolveUserIdByPublicId(invited_by_user_public_id);
      if (inviterId === null) throw new NotFoundError('User');
      // sec-T1: derive email from the membership's user — the client no longer
      // supplies it, so the stored invitation email always matches the actual
      // membership user (defense-in-depth alongside the accept-side email check).
      if (!this.userService) {
        throw new ConfigurationError(
          'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
        );
      }
      const memberUserPublicId = await this.organizationRepository.resolveUserPublicIdByInternalId(
        membership.user_id,
      );
      if (!memberUserPublicId) throw new NotFoundError('User');
      const memberUser = await this.userService.requireUserRecordByPublicId(memberUserPublicId);
      const memberEmail = memberUser.email;
      if (isDisposableEmailBlocked(memberEmail)) {
        throw new ValidationError('errors:disposableEmail', undefined, undefined, [
          { field: 'email', messageKey: 'errors:disposableEmail' },
        ]);
      }
      const token = generateInvitationToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parsed.expires_in_days);
      const row = await this.invitationRepository.create({
        membership_id: membership.id,
        email: memberEmail,
        token_hash: hashInvitationToken(token),
        invited_by_user_id: inviterId,
        expires_at: expiresAt,
        created_by_user_id: inviterId,
      });
      const output = serializeMemberInvitation(row, membership.public_id);

      // R2: emitStrict (not emit) so a failed mail-outbox write propagates and
      // rolls back this org transaction — the invitation row + token_hash and
      // the secret-bearing outbox row commit together or not at all. The raw
      // token leaves the service only through the email payload below.
      await eventBus.emitStrict(
        buildDomainEvent(
          MEMBER_INVITATION_EVENT.CREATED,
          {
            email: memberEmail,
            organization_name: organization.name ?? organization.public_id,
            inviter_name: invited_by_user_public_id,
            token,
            invitation_public_id: output.id,
            expires_in_days: parsed.expires_in_days,
          } satisfies MemberInvitationEmailPayload,
          options?.requestId !== undefined ? { requestId: options.requestId } : undefined,
        ),
      );

      return output;
    });
  }

  async accept(
    invitation_public_id: string,
    body: unknown,
    actingUserPublicId: string,
  ): Promise<MemberInvitationOutput> {
    const parsed = validateAcceptMemberInvitation(body);
    // sec-T4: previously accept was unauthenticated, so anyone with the
    // invitation URL could flip the victim's pending membership to ACTIVE.
    // Bind the acting user's email to the invitee email — mirrors the
    // decline path which has always had this check.
    if (!this.userService) {
      throw new Error(
        'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
      );
    }
    const actingUser = await this.userService.requireUserRecordByPublicId(actingUserPublicId);
    if (!actingUser) throw new NotFoundError('User');
    /**
     * Public route: no org context up front. Resolve the owning org via the
     * SECURITY DEFINER lookup, then wrap the read + UPDATE in
     * `withOrganizationDatabaseContext` so RLS sees the org GUC.
     */
    const lookup =
      await this.invitationRepository.lookupOrganizationByInvitationPublicId(invitation_public_id);
    if (!lookup) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
    return withOrganizationDatabaseContext(lookup.organization_public_id, async () => {
      const row = await this.invitationRepository.findByPublicId(invitation_public_id);
      if (!row) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      if (row.email.toLowerCase() !== actingUser.email.toLowerCase()) {
        throw new ForbiddenError('errors:invitationEmailMismatch');
      }
      const tokenHash = hashInvitationToken(parsed.token);
      const now = new Date();
      assertInvitationAcceptable(row, now);
      const updated = await this.invitationRepository.accept(invitation_public_id, tokenHash, now);
      if (!updated) {
        const current = await this.invitationRepository.findByPublicId(invitation_public_id);
        throwInvitationAcceptFailure(current, now);
      }
      /**
       * Atomically activate the membership in the same transaction so accepting
       * the token actually grants access (permission resolution requires
       * `memberships.status = 'ACTIVE'`). Without this the invitation flow set
       * `accepted_at` but left the membership `INVITED`, so the user appeared
       * to have no access until a manager separately PATCHed the status.
       */
      const activatedMembership = await this.membershipRepository.activateForInvitationAccept(
        lookup.membership_id,
        lookup.organization_id,
      );
      if (!activatedMembership) throw new NotFoundError('Membership');
      const memberUserPublicId = await this.organizationRepository.resolveUserPublicIdByInternalId(
        activatedMembership.user_id,
      );
      if (memberUserPublicId) {
        await invalidatePermissions(memberUserPublicId, lookup.organization_public_id);
      }
      return serializeMemberInvitation(updated, lookup.membership_public_id);
    });
  }

  async revoke(organization_public_id: string, invitation_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const row = await this.invitationRepository.findByPublicId(invitation_public_id);
      if (!row) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      const membership = await this.membershipRepository.findById(row.membership_id);
      if (!membership || membership.organization_id !== organization.id)
        throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      const updated = await this.invitationRepository.revoke(invitation_public_id);
      if (!updated) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
    });
  }

  async resend(
    organization_public_id: string,
    invitation_public_id: string,
    body: unknown,
    options?: MemberInvitationCommandOptions,
  ): Promise<MemberInvitationOutput> {
    const parsed = validateResendMemberInvitation(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const row = await this.invitationRepository.findByPublicId(invitation_public_id);
      if (!row) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      const membership = await this.membershipRepository.findById(row.membership_id);
      if (!membership || membership.organization_id !== organization.id)
        throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      if (row.accepted_at)
        throw new ValidationError('errors:validation.invitationAlreadyAccepted', undefined, {});
      if (row.revoked_at)
        throw new ValidationError('errors:validation.invitationRevoked', undefined, {});
      if (new Date() > row.expires_at)
        throw new ValidationError('errors:validation.invitationExpired', undefined, {});
      const token = generateInvitationToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parsed.expires_in_days);
      const updated = await this.invitationRepository.resend(
        invitation_public_id,
        hashInvitationToken(token),
        expiresAt,
      );
      if (!updated) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      const output = serializeMemberInvitation(updated, membership.public_id);

      // R2: emitStrict so the rotated token_hash (already persisted above in this
      // same org transaction) and the new outbox row commit atomically. The old
      // token was overwritten by `resend`, so a swallowed email failure would
      // otherwise leave the invitee with no working link and no error surfaced.
      await eventBus.emitStrict(
        buildDomainEvent(
          MEMBER_INVITATION_EVENT.RESENT,
          {
            email: row.email,
            organization_name: organization.name ?? organization.public_id,
            inviter_name: 'Team member',
            token,
            invitation_public_id: output.id,
            expires_in_days: parsed.expires_in_days,
          } satisfies MemberInvitationEmailPayload,
          options?.requestId !== undefined ? { requestId: options.requestId } : undefined,
        ),
      );

      return output;
    });
  }

  async listPendingInvitations(
    user_public_id: string,
    query: unknown,
  ): Promise<PendingMemberInvitationListResult> {
    if (!this.userService) {
      throw new ConfigurationError(
        'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
      );
    }
    const parsed = validateListPendingMemberInvitationsQuery(query);
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    /**
     * Cross-organization read: a single user may have invitations from many orgs and
     * no `app.current_organization_id` matches all of them. Uses the SECURITY DEFINER
     * lookup that runs outside RLS but exposes only minimal non-sensitive metadata.
     * Cursor-paginated (R5 / TEN-35) so users invited to >100 orgs can page through
     * every invitation instead of being silently capped at 100.
     */
    const page = await this.invitationRepository.findByEmailPending(
      user.email,
      omitUndefined({ after: parsed.after, limit: parsed.limit }),
    );
    return {
      items: page.items.map((row) =>
        serializeMemberInvitation(
          {
            public_id: row.invitation_public_id,
            email: row.invitation_email,
            expires_at: row.invitation_expires_at,
            accepted_at: null,
            revoked_at: null,
            created_at: row.invitation_created_at,
            membership_id: row.membership_id,
          },
          row.membership_public_id,
        ),
      ),
      limit: page.limit,
      has_more: page.has_more,
      next_cursor: page.next_cursor,
    };
  }

  async decline(invitation_public_id: string, user_public_id: string): Promise<void> {
    if (!this.userService) {
      throw new ConfigurationError(
        'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
      );
    }
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    /**
     * User-driven cross-org route: resolve the owning org via SECURITY DEFINER lookup,
     * then wrap the read + UPDATE in `withOrganizationDatabaseContext`.
     */
    const lookup =
      await this.invitationRepository.lookupOrganizationByInvitationPublicId(invitation_public_id);
    if (!lookup) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
    return withOrganizationDatabaseContext(lookup.organization_public_id, async () => {
      const row = await this.invitationRepository.findByPublicId(invitation_public_id);
      if (!row) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
      if (row.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new ForbiddenError('errors:declineOwnInvitationOnly');
      }
      if (row.accepted_at)
        throw new ValidationError('errors:validation.invitationAlreadyAccepted', undefined, {});
      if (row.revoked_at)
        throw new ValidationError('errors:validation.invitationAlreadyDeclined', undefined, {});
      const updated = await this.invitationRepository.revoke(invitation_public_id);
      if (!updated) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
    });
  }
}
