import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/errors/index.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { MemberInvitationRepository } from './member-invitation.repository.js';
import type { MemberInvitationOutput, MemberInvitationRow } from './member-invitation.types.js';
import {
  validateAcceptMemberInvitation,
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

const MEMBER_INVITATION_RESOURCE = 'Member invitation';

function assertInvitationAcceptable(row: MemberInvitationRow, now: Date): void {
  if (row.revoked_at) {
    throw new ValidationError('errors:validation.invitationRevoked', undefined, {}).withReason(
      'invitation_revoked',
    );
  }
  if (row.accepted_at) {
    throw new ValidationError(
      'errors:validation.invitationAlreadyAccepted',
      undefined,
      {},
    ).withReason('invitation_already_accepted');
  }
  if (now > row.expires_at) {
    throw new ValidationError('errors:validation.invitationExpired', undefined, {}).withReason(
      'invitation_expired',
    );
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
 * Inputs to {@link MemberInvitationService.createForMembership} — the invitation half of the
 * add-member-by-email flow (REQ-1). The membership is created first by `MembershipService.create`;
 * this issues the token + email for it.
 *
 * @remarks
 * - **Notes:** `invited_by_user_id` is the acting admin's internal id (the invitation's
 *   `invited_by_user_id` FK is NOT NULL); `inviter_label` is the display string for the email body;
 *   `requestId` propagates the HTTP request id into the post-commit mail dispatch (omit on non-HTTP
 *   callers). Carrier-only DTO — it holds no behavior.
 */
export interface CreateInvitationForMembershipParams {
  organization_name: string;
  membership_id: number;
  membership_public_id: string;
  email: string;
  expires_in_days: number;
  invited_by_user_id: number;
  inviter_label: string;
  requestId?: string;
}

/**
 * Application service for organization-member invitations: issue-for-membership, accept, resend,
 * and revoke.
 *
 * @remarks
 * - **Algorithm:** invitations carry a single-use opaque token. On issue/resend
 *   {@link generateInvitationToken} produces a 64-char hex secret; only the SHA-256 hash from
 *   {@link hashInvitationToken} is persisted as `token_hash`. Org-scoped methods (resend/revoke)
 *   run inside {@link withOrganizationDatabaseContext}; {@link MemberInvitationService.createForMembership}
 *   is called from within `MembershipService.create`'s existing org transaction (it does not open its
 *   own). The public accept route has no org context up front — it calls the SECURITY DEFINER lookup
 *   `lookupOrganizationByInvitationPublicId` to resolve the owning org, then wraps the UPDATE in
 *   `withOrganizationDatabaseContext`.
 * - **Failure modes:** `NotFoundError` for missing org/membership/invitation; `ValidationError`
 *   (i18n keys `errors:validation.invalidToken`, `invitationRevoked`, `invitationAlreadyAccepted`,
 *   `invitationExpired`) for state/input violations; `ForbiddenError('errors:invitationEmailMismatch')`
 *   when the accepting user's email does not match the invitee.
 * - **Side effects:** writes to `tenancy.member_invitations`; `accept` additionally activates the
 *   linked `tenancy.memberships` row (`status='ACTIVE'`, `joined_at=now()`) and purges the member's
 *   Redis permission cache; `revoke` soft-deletes the auto-created `INVITED` membership so the members
 *   table shows no ghost invitee. Emits {@link MEMBER_INVITATION_EVENT.CREATED} / `RESENT` on the
 *   in-process event bus (the invitation-email handler turns these into a mail-outbox row dispatched on
 *   commit). The raw token is delivered **only** through the email — never in any HTTP response. Issue
 *   and resend use `emitStrict` so a failed outbox write rolls back the surrounding org transaction,
 *   making token issuance and email delivery atomic.
 * - **Notes:** invitations have mutually-exclusive terminal states (`accepted_at` vs `revoked_at`);
 *   resend regenerates the token and pushes `expires_at`.
 */
export class MemberInvitationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly invitationRepository: MemberInvitationRepository,
    private readonly userService?: UserService,
  ) {}

  /**
   * Issues an invitation (token + email) for an already-created `INVITED` membership — the invitation
   * half of `MembershipService.create` (REQ-1).
   *
   * @remarks
   * - **Algorithm:** mints a single-use token, persists only its hash, and `emitStrict`s the CREATED
   *   mail event so the `token_hash` row and the secret-bearing outbox row commit atomically with the
   *   surrounding membership transaction.
   * - **Failure modes:** propagates a failed outbox write (rolls back the org transaction).
   * - **Side effects:** INSERTs `member_invitations`; enqueues the invitation email (raw token only via email).
   * - **Notes:** MUST be called inside the caller's `withOrganizationDatabaseContext` (it does not open one).
   */
  async createForMembership(
    params: CreateInvitationForMembershipParams,
  ): Promise<MemberInvitationOutput> {
    const token = generateInvitationToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + params.expires_in_days);
    const row = await this.invitationRepository.create({
      membership_id: params.membership_id,
      email: params.email,
      token_hash: hashInvitationToken(token),
      invited_by_user_id: params.invited_by_user_id,
      expires_at: expiresAt,
      created_by_user_id: params.invited_by_user_id,
    });
    const output = serializeMemberInvitation(row, params.membership_public_id);
    await eventBus.emitStrict(
      buildDomainEvent(
        MEMBER_INVITATION_EVENT.CREATED,
        {
          email: params.email,
          organization_name: params.organization_name,
          inviter_name: params.inviter_label,
          token,
          invitation_public_id: output.id,
          expires_in_days: params.expires_in_days,
        } satisfies MemberInvitationEmailPayload,
        params.requestId !== undefined ? { requestId: params.requestId } : undefined,
      ),
    );
    return output;
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
      // REQ-1: the membership was auto-created by the invite (add-member-by-email). Revoking the
      // only invitation removes the invitee entirely, so soft-delete the dangling INVITED membership
      // (revoke only succeeds on a non-accepted invitation, so the row is always still INVITED) —
      // the members table never shows a ghost invitee. accept remains the only path to ACTIVE.
      await this.membershipRepository.softDelete(membership.public_id, organization.id);
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
}
