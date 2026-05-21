import type {
  OrganizationApiKeyRow,
  OrganizationApiKeyOutput,
} from './organization-api-key.types.js';

export function serializeOrganizationApiKey(
  row: OrganizationApiKeyRow,
  organization_public_id: string,
): OrganizationApiKeyOutput {
  return {
    id: row.public_id,
    organization_id: organization_public_id,
    name: row.name,
    key_prefix: row.key_prefix,
    last_used_at: row.last_used_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    status: row.status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
