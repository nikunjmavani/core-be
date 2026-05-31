import { eventBus, type DomainEvent } from '@/core/events/event-bus.js';
import { dispatchOutboxEmail, recordOutboxEmail } from '@/infrastructure/mail/queues/mail.queue.js';
import { invitationTemplate } from '@/infrastructure/mail/templates/invitation.template.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  MEMBER_INVITATION_EVENT,
  type MemberInvitationEmailPayload,
} from './member-invitation.events.js';

async function handleMemberInvitationEmail(payload: MemberInvitationEmailPayload): Promise<void> {
  if (!isMailConfigured()) {
    logger.warn({ email: payload.email }, 'Mail not configured — invitation email skipped');
    return;
  }

  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';
  const acceptUrl = `${frontendUrl}/invitations/${payload.invitation_public_id}/accept?token=${payload.token}`;

  const html = invitationTemplate({
    inviterName: payload.inviter_name,
    organizationName: payload.organization_name,
    acceptUrl,
    expiresInDays: payload.expires_in_days,
  });

  const mailOutboxId = await recordOutboxEmail({
    to: payload.email,
    subject: `You've been invited to join ${payload.organization_name}`,
    html,
    tags: [{ name: 'category', value: 'invitation' }],
  });
  eventBus.onCommit(() => dispatchOutboxEmail(mailOutboxId));
}

async function onMemberInvitationEmailEvent(event: DomainEvent): Promise<void> {
  const payload = event.payload as MemberInvitationEmailPayload;
  try {
    await handleMemberInvitationEmail(payload);
  } catch (error) {
    logger.warn(
      { error, eventType: event.type, email: payload.email },
      'member-invitation.email.enqueue.failed',
    );
    throw error;
  }
}

let memberInvitationHandlersRegistered = false;

/**
 * Subscribes the invitation email handler to {@link MEMBER_INVITATION_EVENT}
 * `CREATED` and `RESENT`. Idempotent: re-invocation is a no-op so the API and
 * worker bootstraps can both call it without double-wiring listeners.
 */
export function registerMemberInvitationEventHandlers(): void {
  if (memberInvitationHandlersRegistered) return;
  memberInvitationHandlersRegistered = true;
  eventBus.on(MEMBER_INVITATION_EVENT.CREATED, onMemberInvitationEmailEvent);
  eventBus.on(MEMBER_INVITATION_EVENT.RESENT, onMemberInvitationEmailEvent);
}
