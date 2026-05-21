import { registerMemberInvitationEventHandlers } from '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.event-handlers.js';

let tenancyEventHandlersRegistered = false;

export function registerTenancyEventHandlers(): void {
  if (tenancyEventHandlersRegistered) return;
  tenancyEventHandlersRegistered = true;
  registerMemberInvitationEventHandlers();
}
