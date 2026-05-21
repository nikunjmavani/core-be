/**
 * Process-wide shutdown drain flag. Set at the start of SIGTERM/SIGINT handling so
 * load balancers stop routing before connection pool and queues close.
 */
let applicationDraining = false;

export function setApplicationDraining(draining: boolean): void {
  applicationDraining = draining;
}

export function isApplicationDraining(): boolean {
  return applicationDraining;
}

/** Test-only reset — avoids bleed between Vitest cases in the same process. */
export function resetApplicationDrainingForTests(): void {
  applicationDraining = false;
}
