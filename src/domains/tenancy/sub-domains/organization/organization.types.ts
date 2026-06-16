/** Internal domain row mirroring `tenancy.organizations` — includes audit columns and soft-delete. */
export interface Organization {
  id: number;
  public_id: string;
  name: string;
  /** Null for PERSONAL organizations (no human handle); kebab string for TEAM. */
  slug: string | null;
  /** `PERSONAL` (single-owner workspace) or `TEAM` (shareable). */
  type: string;
  owner_user_id: number;
  status: string;
  logo_url: string | null;
  stripe_customer_id: string | null;
  deleted_at: Date | null;
  deletion_started_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Capability flags derived from the organization `type`. They describe what the
 * organization TYPE supports — NOT the caller's permissions. A TEAM organization
 * reports every flag `true` regardless of who is asking; a PERSONAL organization
 * (single-member, immutable) reports every flag `false`. Clients use these to hide
 * UI / skip calls that the active organization would reject with 422.
 */
export interface OrganizationCapabilities {
  /** TEAM only — `POST /tenancy/organization/invitations`. */
  can_invite_members: boolean;
  /** TEAM only — `POST /tenancy/organization/memberships`. */
  can_manage_members: boolean;
  /** TEAM only — `POST /tenancy/organization/roles` (custom roles). */
  can_manage_roles: boolean;
  /** TEAM only — `POST /tenancy/organization/transfer-ownership`. */
  can_transfer_ownership: boolean;
  /** TEAM only — `DELETE /tenancy/organization`. */
  can_delete: boolean;
}

/** Public organization shape returned by the API — produced by {@link serializeOrganization}. */
export interface OrganizationOutput {
  id: string;
  name: string;
  /** Null for the personal organization. */
  slug: string | null;
  type: string;
  status: string;
  logo_url: string | null;
  /** Type-derived capability flags (see {@link OrganizationCapabilities}). */
  capabilities: OrganizationCapabilities;
  created_at: string;
  updated_at: string;
}

/** Internal organization fields exposed to cross-domain billing services. */
export interface OrganizationBillingContext {
  id: number;
  public_id: string;
  name: string;
  slug: string | null;
  type: string;
  stripe_customer_id: string | null;
}

/** Organization fields required for membership flows within the tenancy domain. */
export interface OrganizationMembershipContext extends OrganizationBillingContext {
  owner_user_id: number;
}
