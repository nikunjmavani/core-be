/**
 * Registers auth/tenancy in-process event handlers (email side effects).
 * Notify + billing webhook listeners register in `registerNotifyContainer()` via
 * `domain-containers.plugin.ts` because they need container-wired repositories.
 */
import { registerAuthEventHandlers } from '@/domains/auth/events/index.js';
import { registerTenancyEventHandlers } from '@/domains/tenancy/events/index.js';

let handlersRegistered = false;

export function registerEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerAuthEventHandlers();
  registerTenancyEventHandlers();
}
