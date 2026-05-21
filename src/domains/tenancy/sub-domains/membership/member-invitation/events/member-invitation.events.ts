export const MEMBER_INVITATION_EVENT = {
  CREATED: 'tenancy.member_invitation.created',
  RESENT: 'tenancy.member_invitation.resent',
} as const;

export type MemberInvitationEventType =
  (typeof MEMBER_INVITATION_EVENT)[keyof typeof MEMBER_INVITATION_EVENT];

export interface MemberInvitationEmailPayload {
  email: string;
  organization_name: string;
  inviter_name: string;
  token: string;
  invitation_public_id: string;
  expires_in_days: number;
}
