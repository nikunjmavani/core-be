import { registerAuthMethodEventHandlers } from '@/domains/auth/sub-domains/auth-method/events/auth.event-handlers.js';

let authEventHandlersRegistered = false;

/** Aggregator that wires every auth-domain event handler exactly once (currently the auth-method handlers that enqueue email verification-code / password-reset emails). Idempotent — safe to call from multiple bootstraps. */
export function registerAuthEventHandlers(): void {
  if (authEventHandlersRegistered) return;
  authEventHandlersRegistered = true;
  registerAuthMethodEventHandlers();
}
