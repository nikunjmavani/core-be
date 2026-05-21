export interface OrganizationApiKeyRow {
  id: number;
  public_id: string;
  organization_id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  status: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
}

export interface OrganizationApiKeyOutput {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateOrganizationApiKeyResult {
  api_key: OrganizationApiKeyOutput;
  raw_key: string;
}

export interface OrganizationApiKeyAuthMatch {
  public_id: string;
  organization_public_id: string;
  scopes: string[];
}
