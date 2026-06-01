/**
 * Raw `tenancy.memberships` row shape from Drizzle. Holds internal numeric
 * ids and the soft-delete marker (`deleted_at`); do not return this shape
 * directly from HTTP handlers — serialize via {@link serializeMembership}.
 */
export interface MembershipRow {
  id: number;
  public_id: string;
  user_id: number;
  organization_id: number;
  role_id: number;
  status: string;
  invited_by_user_id: number | null;
  joined_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public HTTP response shape for a membership. All identifiers are external
 * public ids (or string-coerced numeric ids where the org id is not yet
 * resolved); timestamps are ISO-8601 strings.
 */
export interface MembershipOutput {
  id: string;
  user_id: string;
  organization_id: string;
  role_id: string;
  status: string;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}
