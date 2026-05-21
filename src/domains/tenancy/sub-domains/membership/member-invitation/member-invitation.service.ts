import {
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/index.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import type { OrganizationRepository } from '../../organization/organization.repository.js';
import type { MembershipRepository } from '../membership.repository.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { MemberInvitationRepository } from './member-invitation.repository.js';
import type { MemberInvitationOutput } from './member-invitation.types.js';
import {
  validateCreateMemberInvitation,
  validateAcceptMemberInvitation,
  validateResendMemberInvitation,
} from './member-invitation.validator.js';
import { serializeMemberInvitation } from './member-invitation.serializer.js';
import { hashInvitationToken, generateInvitationToken } from './member-invitation.token.js';
import { eventBus } from '@/core/events/event-bus.js';
import {
  MEMBER_INVITATION_EVENT,
  type MemberInvitationEmailPayload,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.events.js';

const MEMBER_INVITATION_RESOURCE = 'Member invitation';

export class MemberInvitationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly invitationRepository: MemberInvitationRepository,
    private readonly userService?: UserService,
  ) {}

  async list(organization_public_id: string, limit = 100): Promise<MemberInvitationOutput[]> {
    const organization = await this.organizationRepository.findByPublicId(organization_public_id);
    if (!organization) throw new NotFoundError('Organization');
    const rows = await this.invitationRepository.findByOrganizationId(organization.id, limit);
    type RowWithPublicId = (typeof rows)[number] & { membership_public_id: string };
    return rows.map((row) =>
      serializeMemberInvitation(row, (row as RowWithPublicId).membership_public_id),
    );
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
  }

  async accept(invitation_public_id: string, body: unknown): Promise<MemberInvitationOutput> {
    const parsed = validateAcceptMemberInvitation(body);
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
    const membership = await this.membershipRepository.findById(row.membership_id);
    return serializeMemberInvitation(updated, membership?.public_id ?? String(row.membership_id));
  }

  async revoke(organization_public_id: string, invitation_public_id: string): Promise<void> {
    const organization = await this.organizationRepository.findByPublicId(organization_public_id);
    if (!organization) throw new NotFoundError('Organization');
    const row = await this.invitationRepository.findByPublicId(invitation_public_id);
    if (!row) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
    const membership = await this.membershipRepository.findById(row.membership_id);
    if (!membership || membership.organization_id !== organization.id)
      throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
    const updated = await this.invitationRepository.revoke(invitation_public_id);
    if (!updated) throw new NotFoundError(MEMBER_INVITATION_RESOURCE);
  }

  async resend(
    organization_public_id: string,
    invitation_public_id: string,
    body: unknown,
  ): Promise<{ invitation: MemberInvitationOutput; token: string }> {
    const parsed = validateResendMemberInvitation(body);
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
  }

  async listPendingInvitations(user_public_id: string): Promise<MemberInvitationOutput[]> {
    if (!this.userService) {
      throw new ConfigurationError(
        'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
      );
    }
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    const rows = await this.invitationRepository.findByEmailPending(user.email, 100);
    return rows.map((row) => serializeMemberInvitation(row.invitation, row.membership_public_id));
  }

  async decline(invitation_public_id: string, user_public_id: string): Promise<void> {
    if (!this.userService) {
      throw new ConfigurationError(
        'UserService is not configured on MemberInvitationService. Wire it via tenancy.container.',
      );
    }
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
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
  }
}
