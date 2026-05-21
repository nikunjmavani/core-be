/** Organization permission codes re-exported from tenancy seed data for RBAC validation. */
import { SYSTEM_PERMISSIONS } from '@/domains/tenancy/sub-domains/permission/permission.seed.js';

/** Canonical permission codes seeded in tenancy.permissions — used for RBAC validation. */
export const ALL_PERMISSIONS = SYSTEM_PERMISSIONS.map(
  (permission) => permission.code,
) as readonly string[];

const ALL_PERMISSIONS_SET = new Set<string>(ALL_PERMISSIONS);

export function isKnownPermissionCode(code: string): boolean {
  return ALL_PERMISSIONS_SET.has(code);
}
