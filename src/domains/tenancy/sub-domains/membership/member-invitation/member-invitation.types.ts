/**
 * Raw `tenancy.member_invitations` row as returned by Drizzle. Contains the
 * SHA-256 `token_hash` and internal numeric ids — never serialize this shape
 * directly to API consumers.
 */
export interface MemberInvitationRow {
  id: number;
  public_id: string;
  membership_id: number;
  email: string;
  token_hash: string;
  invited_by_user_id: number;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

/**
 * Public HTTP response shape for a member invitation. `id` and `membership_id`
 * are external public ids; timestamps are ISO-8601. No token material leaves
 * the service through this shape.
 */
export interface MemberInvitationOutput {
  id: string;
  membership_id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
