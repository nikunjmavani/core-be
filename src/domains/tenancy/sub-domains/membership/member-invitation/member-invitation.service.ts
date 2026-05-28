import {
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '../../organization/organization.repository.js';
import type { MembershipRepository } from '../membership.repository.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { MemberInvitationRepository } from './member-invitation.repository.js';
import type { MemberInvitationOutput } from './member-invitation.types.js';
import {
  validateCreateMemberInvitation,
  validateAcceptMemberInvitation,
  validateListMemberInvitationsQuery,
  validateResendMemberInvitation,
} from './member-invitation.validator.js';
import { serializeMemberInvitation } from './member-invitation.serializer.js';
import { hashInvitationToken, generateInvitationToken } from './member-invitation.token.js';
import { eventBus } from '@/core/events/event-bus.js';
import {
  MEMBER_INVITATION_EVENT,
  type MemberInvitationEmailPayload,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.events.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const MEMBER_INVITATION_RESOURCE = 'Member invitation';

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
 *   decline somebody else's invitation; `ConfigurationError` if the optional
 *   `UserService` is required but not wired by the container.
 * - **Side effects:** writes to `tenancy.member_invitations`; emits
 *   {@link MEMBER_INVITATION_EVENT.CREATED} / `RESENT` on the in-process
 *   event bus, which the invitation email handler turns into a mail-outbox
 *   row dispatched on commit. The raw token is only returned to the API
 *   caller and embedded in the outgoing email — it never leaves the service
 *   in any other form.
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
  ): Promise<{ invitation: MemberInvitationOutput; token: string }> {
    const parsed = validateCreateMemberInvitation(body);
    if (isDisposableEmailBlocked(parsed.email)) {
      throw new ValidationError('errors:disposableEmail', undefined, undefined, [
        { field: 'email', messageKey: 'errors:disposableEmail' },
      ]);
    }
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const membership = await this.membershipRepository.findByPublicId(
        parsed.membership_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      const inviterId =
        await this.organizationRepository.resolveUserIdByPublicId(invited_by_user_public_id);
      if (inviterId === null) throw new NotFoundError('User');
      const token = generateInvitationToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parsed.expires_in_days);
      const row = await this.invitationRepository.create({
        membership_id: membership.id,
        email: parsed.email,
        token_hash: hashInvitationToken(token),
        invited_by_user_id: inviterId,
        expires_at: expiresAt,
        created_by_user_id: inviterId,
      });
      const output = serializeMemberInvitation(row, membership.public_id);

      await eventBus.emit({
        type: MEMBER_INVITATION_EVENT.CREATED,
        payload: {
          email: parsed.email,
          organization_name: organization.name ?? organization.public_id,
          inviter_name: invited_by_user_public_id,
          token,
          invitation_public_id: output.id,
          expires_in_days: parsed.expires_in_days,
        } satisfies MemberInvitationEmailPayload,
        timestamp: new Date(),
      });

      return { invitation: output, token };
    });
  }

  async accept(invitation_public_id: string, body: unknown): Promise<MemberInvitationOutput> {
    const parsed = validateAcceptMemberInvitation(body);
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
      const tokenHash = hashInvitationToken(parsed.token);
      if (row.token_hash !== tokenHash)
        throw new ValidationError('errors:validation.invalidToken', undefined, {
          token: ['Invalid or expired'],
        });
      if (row.revoked_at)
        throw new ValidationError('errors:validation.invitationRevoked', undefined, {});
      if (row.accepted_at)
        throw new ValidationError('errors:validation.invitationAlreadyAccepted', undefined, {});
      if (new Date() > row.expires_at)
        throw new ValidationError('errors:validation.invitationExpired', undefined, {});
      const updated = await this.invitationRepository.accept(invitation_public_id);
      if (!updated) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
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
  ): Promise<{ invitation: MemberInvitationOutput; token: string }> {
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

      await eventBus.emit({
        type: MEMBER_INVITATION_EVENT.RESENT,
        payload: {
          email: row.email,
          organization_name: organization.name ?? organization.public_id,
          inviter_name: 'Team member',
          token,
          invitation_public_id: output.id,
          expires_in_days: parsed.expires_in_days,
        } satisfies MemberInvitationEmailPayload,
        timestamp: new Date(),
      });

      return { invitation: output, token };
    });
  }

  async listPendingInvitations(user_public_id: string): Promise<MemberInvitationOutput[]> {
    if (!this.userService) {
      throw new ConfigurationError(
        'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
      );
    }
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    /**
     * Cross-organization read: a single user may have invitations from many orgs and
     * no `app.current_organization_id` matches all of them. Uses the SECURITY DEFINER
     * lookup that runs outside RLS but exposes only minimal non-sensitive metadata.
     */
    const rows = await this.invitationRepository.findByEmailPending(user.email, 100);
    return rows.map((row) =>
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
    );
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
