/**
 * Registers auth/tenancy in-process event handlers (email side effects).
 * Notify + billing webhook listeners register in `registerNotifyContainer()` via
 * `domain-containers.plugin.ts` because they need container-wired repositories.
 */
import { registerAuthEventHandlers } from '@/domains/auth/events/index.js';
import { registerTenancyEventHandlers } from '@/domains/tenancy/events/index.js';

let handlersRegistered = false;

/**
 * One-shot registration of the in-process domain event handlers that don't
 * require container-wired repositories (auth + tenancy email side effects).
 * Idempotent — safe to call from `buildApp` and worker entry points; the
 * second call is a no-op.
 */
export function registerEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerAuthEventHandlers();
  registerTenancyEventHandlers();
}
