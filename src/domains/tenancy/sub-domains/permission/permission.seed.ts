/**
 * Tenancy permission seed — system permission codes.
 * Domain-owned; used by scripts/seed orchestration.
 *
 * Codes must match domain permission constants (e.g. tenancy.permissions.ts,
 * billing.permissions.ts) and docs/routes.txt — routes enforce these exact strings.
 */
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { permissions } from './permission.schema.js';

export const SYSTEM_PERMISSIONS = [
  // Tenancy
  { code: 'organization:read', name: 'View Organization', category: 'tenancy' },
  { code: 'organization:update', name: 'Update Organization', category: 'tenancy' },
  { code: 'organization:delete', name: 'Delete Organization', category: 'tenancy' },
  { code: 'membership:read', name: 'View Members', category: 'tenancy' },
  { code: 'membership:manage', name: 'Manage Members', category: 'tenancy' },
  { code: 'invitation:manage', name: 'Manage Invitations', category: 'tenancy' },
  { code: 'role:read', name: 'View Roles', category: 'tenancy' },
  { code: 'role:manage', name: 'Manage Roles', category: 'tenancy' },
  { code: 'api-key:read', name: 'View API Keys', category: 'tenancy' },
  { code: 'api-key:manage', name: 'Manage API Keys', category: 'tenancy' },
  {
    code: 'notification-policy:read',
    name: 'View Notification Policies',
    category: 'tenancy',
  },
  {
    code: 'notification-policy:manage',
    name: 'Manage Notification Policies',
    category: 'tenancy',
  },
  // Billing
  { code: 'subscription:read', name: 'View Subscription', category: 'billing' },
  { code: 'subscription:manage', name: 'Manage Subscription', category: 'billing' },
  // Notify
  { code: 'webhook:read', name: 'View Webhooks', category: 'notify' },
  { code: 'webhook:manage', name: 'Manage Webhooks', category: 'notify' },
  // Audit
  { code: 'audit-log:read', name: 'View Audit Logs', category: 'audit' },
  // Upload
  { code: 'upload:manage', name: 'Manage Uploads', category: 'upload' },
] as const;

export async function seedPermissions(
  codes: Array<{
    code: string;
    name: string;
    category: string;
    description?: string;
  }> = [...SYSTEM_PERMISSIONS],
) {
  return getRequestDatabase().insert(permissions).values(codes).onConflictDoNothing().returning();
}
