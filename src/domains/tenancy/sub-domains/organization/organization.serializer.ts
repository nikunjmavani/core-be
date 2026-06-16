import type { OrganizationCapabilities, OrganizationOutput } from './organization.types.js';

/**
 * Derives the {@link OrganizationCapabilities} flags from an organization `type`.
 *
 * @remarks
 * - Algorithm: a TEAM organization supports every collaboration capability; a
 *   PERSONAL organization (single-member, immutable by definition) supports none.
 *   The flags mirror the service-layer guards that reject these actions with 422
 *   on a personal organization.
 * - Notes: capabilities reflect the organization TYPE, not the caller's
 *   permissions — a TEAM member lacking `invitation:manage` still sees
 *   `can_invite_members: true` (the org supports it; their permission is separate,
 *   enforced per-request and surfaced as 403).
 */
export function organizationCapabilities(type: string): OrganizationCapabilities {
  const enabled = type !== 'PERSONAL';
  return {
    can_invite_members: enabled,
    can_manage_members: enabled,
    can_manage_roles: enabled,
    can_transfer_ownership: enabled,
    can_delete: enabled,
  };
}

/**
 * Maps an organization Drizzle row to the public {@link OrganizationOutput}
 * shape — exposes `public_id` as `id`, drops internal numeric and audit
 * columns, adds type-derived {@link OrganizationCapabilities}, and serialises
 * timestamps as ISO 8601 strings.
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
