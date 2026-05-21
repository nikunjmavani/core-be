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
