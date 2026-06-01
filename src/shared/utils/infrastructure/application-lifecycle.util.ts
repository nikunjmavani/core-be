/**
 * Process-wide shutdown drain flag. Set at the start of SIGTERM/SIGINT handling so
 * load balancers stop routing before connection pool and queues close.
 */
let applicationDraining = false;

/** Toggles the process-wide drain flag; called from the SIGTERM/SIGINT handler. */
export function setApplicationDraining(draining: boolean): void {
  applicationDraining = draining;
}

/** Returns true once {@link setApplicationDraining} has been called with `true`; readiness probes use this to flip status to `draining`. */
export function isApplicationDraining(): boolean {
  return applicationDraining;
}

/** Test-only reset — avoids bleed between Vitest cases in the same process. */
export function resetApplicationDrainingForTests(): void {
  applicationDraining = false;
}
