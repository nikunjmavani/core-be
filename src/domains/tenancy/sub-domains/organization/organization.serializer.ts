import type { OrganizationOutput } from './organization.types.js';

export function serializeOrganization(row: {
  public_id: string;
  name: string;
  slug: string;
  status: string;
  logo_url: string | null;
  created_at: Date;
  updated_at: Date;
}): OrganizationOutput {
  return {
    id: row.public_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    logo_url: row.logo_url,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
