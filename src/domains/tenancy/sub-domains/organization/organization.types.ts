export interface Organization {
  id: number;
  public_id: string;
  name: string;
  slug: string;
  owner_user_id: number;
  status: string;
  logo_url: string | null;
  stripe_customer_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationOutput {
  id: string;
  name: string;
  slug: string;
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
  slug: string;
  stripe_customer_id: string | null;
}

/** Organization fields required for membership flows within the tenancy domain. */
export interface OrganizationMembershipContext extends OrganizationBillingContext {
  owner_user_id: number;
}
