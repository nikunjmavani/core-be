import { organizationCapabilities } from './organization-capability.js';
import type { OrganizationOutput } from './organization.types.js';

/**
 * Maps an organization Drizzle row to the public {@link OrganizationOutput}
 * shape — exposes `public_id` as `id`, drops internal numeric and audit
 * columns, derives type-based `capabilities`, and serialises timestamps as
 * ISO 8601 strings.
 */
export function serializeOrganization(row: {
  public_id: string;
  name: string;
  slug: string | null;
  type: string;
  status: string;
  logo_url: string | null;
  created_at: Date;
  updated_at: Date;
}): OrganizationOutput {
  return {
    id: row.public_id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    status: row.status,
    logo_url: row.logo_url,
    capabilities: organizationCapabilities(row.type),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
