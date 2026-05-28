import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { BILLING_PERMISSIONS } from '@/domains/billing/billing.permissions.js';
import { AUDIT_PERMISSIONS } from '@/domains/audit/audit.permissions.js';
import { NOTIFY_PERMISSIONS } from '@/domains/notify/notify.permissions.js';
import { UPLOAD_PERMISSIONS } from '@/domains/upload/upload.permissions.js';

/**
 * Union of every permission code recognised by the API, merged from each
 * domain's permission registry. The seed (`tenancy.seed.ts`) writes these into
 * the `permissions` table so authorization checks can resolve them at runtime.
 */
export const ALL_PERMISSIONS = {
  ...TENANCY_PERMISSIONS,
  ...BILLING_PERMISSIONS,
  ...AUDIT_PERMISSIONS,
  ...NOTIFY_PERMISSIONS,
  ...UPLOAD_PERMISSIONS,
} as const;

/**
 * Compile-time string-literal union of every value in {@link ALL_PERMISSIONS}.
 * Use as the type of any function argument that takes a permission code so
 * typos fail at the type level.
 */
export type PermissionCode = (typeof ALL_PERMISSIONS)[keyof typeof ALL_PERMISSIONS];
