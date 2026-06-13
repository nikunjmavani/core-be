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

/** Public organization shape returned by the API — produced by {@link serializeOrganization}. */
export interface OrganizationOutput {
  id: string;
  name: string;
  /** Null for the personal organization. */
  slug: string | null;
  type: string;
  status: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Internal organization fields exposed to cross-domain billing services. */
export interface OrganizationBillingContext {
  id: number;
  public_id: string;
  name: string;
  slug: string | null;
  stripe_customer_id: string | null;
}

/** Organization fields required for membership flows within the tenancy domain. */
export interface OrganizationMembershipContext extends OrganizationBillingContext {
  owner_user_id: number;
}
