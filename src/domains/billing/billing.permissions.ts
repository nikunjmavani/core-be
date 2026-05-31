/**
 * Permission slugs guarded on billing routes; values must match seeded rows in
 * `tenancy.permissions` so {@link requireOrganizationPermission} resolves them.
 */
export const BILLING_PERMISSIONS = {
  SUBSCRIPTION_READ: 'subscription:read',
  SUBSCRIPTION_MANAGE: 'subscription:manage',
} as const;
