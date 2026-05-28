/** In-process count of HTTP requests holding an org-scoped RLS transaction checkout. */
let activeOrganizationRlsCheckouts = 0;

/** Increments the in-process org-RLS checkout gauge when tenant middleware enters its transaction. */
export function incrementOrganizationRlsCheckoutCount(): void {
  activeOrganizationRlsCheckouts += 1;
}

/** Decrements the gauge on transaction commit/rollback; clamps to zero to tolerate replay/test drift. */
export function decrementOrganizationRlsCheckoutCount(): void {
  if (activeOrganizationRlsCheckouts > 0) {
    activeOrganizationRlsCheckouts -= 1;
  }
}

/**
 * Current count of HTTP requests holding an organization-scoped RLS transaction
 * checkout — read by the DB-pool exhaustion alerter to detect saturation before
 * postgres.js starts queuing.
 */
export function getActiveOrganizationRlsCheckoutCount(): number {
  return activeOrganizationRlsCheckouts;
}

/** Test-only: reset checkout counter between Vitest cases. */
export function resetOrganizationRlsCheckoutCountForTests(): void {
  activeOrganizationRlsCheckouts = 0;
}
