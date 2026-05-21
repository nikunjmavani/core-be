export interface MemberRoleRow {
  id: number;
  public_id: string;
  organization_id: number;
  name: string;
  description: string | null;
  is_system: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MemberRoleOutput {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}
