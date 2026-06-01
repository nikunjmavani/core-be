import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';

/**
 * Scoped RLS helper for the post-`DATABASE_RLS_SCOPED_CONTEXTS` migration (production hardening item 2).
 *
 * Opens a short Drizzle transaction, sets `app.current_organization_id` via `SET LOCAL`, and
 * runs `callback` with a pinned `databaseHandle`. When the caller is already inside a worker
 * `withOrganizationContext(...)` (or a legacy request-pinned `organizationRequestDatabaseStorage`
 * session for the same organization) the existing handle is reused — no nested top-level
 * transaction, no extra pool checkout, no lost `SET LOCAL`.
 *
 * Use from services and controllers for the **service-layer unit of work**, not the entire HTTP
 * request. External I/O (Stripe API, S3, Resend) **must not** run inside this callback — phase
 * such work into separate short transactions to avoid holding a pool checkout across network
 * round trips. Enforced by the global regression guard in
 * `src/tests/global/rls-context-network-isolation.global.test.ts`.
 */
export function withOrganizationDatabaseContext<T>(
  organizationPublicId: string,
  callback: (databaseHandle: RequestScopedPostgresDatabase) => Promise<T>,
): Promise<T> {
  return withOrganizationContext(organizationPublicId, callback);
}
