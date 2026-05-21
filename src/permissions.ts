import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { BILLING_PERMISSIONS } from '@/domains/billing/billing.permissions.js';
import { AUDIT_PERMISSIONS } from '@/domains/audit/audit.permissions.js';
import { NOTIFY_PERMISSIONS } from '@/domains/notify/notify.permissions.js';
import { UPLOAD_PERMISSIONS } from '@/domains/upload/upload.permissions.js';

export const ALL_PERMISSIONS = {
  ...TENANCY_PERMISSIONS,
  ...BILLING_PERMISSIONS,
  ...AUDIT_PERMISSIONS,
  ...NOTIFY_PERMISSIONS,
  ...UPLOAD_PERMISSIONS,
} as const;

export type PermissionCode = (typeof ALL_PERMISSIONS)[keyof typeof ALL_PERMISSIONS];
