import { eventBus, scheduleCommitDispatch, type DomainEvent } from '@/core/events/event-bus.js';
import { recordOutboxEmail } from '@/infrastructure/mail/queues/mail.queue.js';
import { invitationTemplate } from '@/infrastructure/mail/templates/invitation.template.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { env } from '@/shared/config/env.config.js';
import { DEFAULT_FRONTEND_URL } from '@/shared/constants/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  MEMBER_INVITATION_EVENT,
  type MemberInvitationEmailPayload,
} from './member-invitation.events.js';

async function handleMemberInvitationEmail(
  payload: MemberInvitationEmailPayload,
  requestId?: string,
): Promise<void> {
  if (!isMailConfigured()) {
    logger.warn({ email: payload.email }, 'Mail not configured — invitation email skipped');
    return;
  }

  const frontendUrl = env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
  // Link to the FRONTEND accept page (core-fe route `/accept-invite/:invitation_id`), which reads
  // the token from the query string and POSTs it to `/api/v1/tenancy/invitations/:id/accept`.
  // NOT the API route — a browser GET on the API path is a POST-only, auth-gated 404 the recipient
  // can never complete.
  const acceptUrl = `${frontendUrl}/accept-invite/${payload.invitation_public_id}?token=${payload.token}`;

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
  await scheduleCommitDispatch(
    { type: 'mail_outbox', mailOutboxId },
    requestId !== undefined ? { requestId } : undefined,
  );
}

async function onMemberInvitationEmailEvent(event: DomainEvent): Promise<void> {
  const payload = event.payload as MemberInvitationEmailPayload;
  try {
    await handleMemberInvitationEmail(payload, event.requestId);
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
