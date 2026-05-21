/** In-process count of HTTP requests holding an org-scoped RLS transaction checkout. */
let activeOrganizationRlsCheckouts = 0;

export function incrementOrganizationRlsCheckoutCount(): void {
  activeOrganizationRlsCheckouts += 1;
}

export function decrementOrganizationRlsCheckoutCount(): void {
  if (activeOrganizationRlsCheckouts > 0) {
    activeOrganizationRlsCheckouts -= 1;
  }
}

export function getActiveOrganizationRlsCheckoutCount(): number {
  return activeOrganizationRlsCheckouts;
}

/** Test-only: reset checkout counter between Vitest cases. */
export function resetOrganizationRlsCheckoutCountForTests(): void {
  activeOrganizationRlsCheckouts = 0;
}
