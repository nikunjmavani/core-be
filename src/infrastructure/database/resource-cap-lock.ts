import { sql as drizzleSql } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';

/**
 * Postgres advisory-lock namespaces (`classid`) used to serialize per-scope
 * count-then-insert resource-cap enforcement (TEN-02 / TEN-13 / TEN-19 / TEN-39).
 *
 * @remarks
 * - **Notes:** each value is the ASCII for a 4-letter mnemonic and is otherwise
 *   arbitrary — only its stability and uniqueness matter. They occupy the two-key
 *   `pg_advisory_xact_lock(classid, objid)` space (with the scope id as `objid`),
 *   distinct from single-key advisory locks such as the migration runner's, so they
 *   never collide. Distinct namespaces per resource keep unrelated caps from
 *   serializing against each other for the same scope id.
 */
export const RESOURCE_CAP_ADVISORY_LOCK_NAMESPACES = {
  /** Owned-TEAM-organization cap, keyed on the owner user id. */
  OWNED_ORGANIZATION: 0x4f_52_47_43, // 'ORGC'
  /** Per-organization API-key cap, keyed on the organization id. */
  ORGANIZATION_API_KEY: 0x41_4b_59_43, // 'AKYC'
  /** Per-organization notification-policy cap, keyed on the organization id. */
  ORGANIZATION_NOTIFICATION_POLICY: 0x4e_50_4c_43, // 'NPLC'
  /** Per-organization custom-role cap, keyed on the organization id. */
  MEMBER_ROLE: 0x52_4f_4c_43, // 'ROLC'
} as const;

/**
 * Takes a transaction-scoped advisory lock that serializes a count-then-insert
 * resource-cap check for one `(namespace, key)` scope.
 *
 * @remarks
 * - **Algorithm:** issues `pg_advisory_xact_lock(namespace, key)` on the active
 *   request database handle; the lock releases automatically at COMMIT/ROLLBACK.
 * - **Failure modes:** propagates Postgres errors; blocks (does not fail) while a
 *   concurrent holder of the same scope is in-flight.
 * - **Side effects:** acquires a transaction-level advisory lock — MUST be called
 *   inside the same transaction as the subsequent count + insert (e.g. within
 *   `withOrganizationDatabaseContext` / `withUserDatabaseContext`) so the cap check
 *   and the insert are atomic with respect to other writers in the same scope.
 * - **Notes:** mirrors the per-user upload-quota lock; converts the previously
 *   "race-safe enough" count-then-insert caps into transactionally strict ones.
 */
export async function acquireResourceCapAdvisoryLock(
  namespace: number,
  key: number,
): Promise<void> {
  await getRequestDatabase().execute(
    drizzleSql`SELECT pg_advisory_xact_lock(${namespace}::int, ${key}::int)`,
  );
}
