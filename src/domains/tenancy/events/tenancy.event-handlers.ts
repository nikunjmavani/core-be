import { registerMemberInvitationEventHandlers } from '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.event-handlers.js';

let tenancyEventHandlersRegistered = false;

/**
 * Aggregator that registers all tenancy-domain in-process event subscribers.
 * Currently wires {@link registerMemberInvitationEventHandlers} so invitation
 * created/resent events trigger the mail queue. Idempotent — safe to call
 * multiple times during boot.
 */
export function registerTenancyEventHandlers(): void {
  if (tenancyEventHandlersRegistered) return;
  tenancyEventHandlersRegistered = true;
  registerMemberInvitationEventHandlers();
}
