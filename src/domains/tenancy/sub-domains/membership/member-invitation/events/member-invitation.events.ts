/**
 * Domain event codes emitted by {@link MemberInvitationService} when an
 * invitation is created or resent. Consumed by the invitation email handler
 * which records an outbox row and dispatches the mail job on commit.
 */
export const MEMBER_INVITATION_EVENT = {
  CREATED: 'tenancy.member_invitation.created',
  RESENT: 'tenancy.member_invitation.resent',
} as const;

/** Union of literal event codes defined by {@link MEMBER_INVITATION_EVENT}. */
export type MemberInvitationEventType =
  (typeof MEMBER_INVITATION_EVENT)[keyof typeof MEMBER_INVITATION_EVENT];

/**
 * Payload carried by {@link MEMBER_INVITATION_EVENT} `CREATED` and `RESENT`.
 * `token` is the raw (un-hashed) invitation token — it is only ever delivered
 * to the invitee via email and never persisted in plaintext.
 */
export interface MemberInvitationEmailPayload {
  email: string;
  organization_name: string;
  inviter_name: string;
  token: string;
  invitation_public_id: string;
  expires_in_days: number;
}
