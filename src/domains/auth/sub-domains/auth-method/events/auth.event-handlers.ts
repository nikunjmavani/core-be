import i18next from 'i18next';
import { eventBus, type DomainEvent } from '@/core/events/event-bus.js';
import {
  dispatchOutboxEmail,
  recordOutboxEmail,
  type MailEnqueueInput,
} from '@/infrastructure/mail/queues/mail.queue.js';
import { magicLinkTemplate } from '@/infrastructure/mail/templates/magic-link.template.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  AUTH_EVENT,
  type EmailVerificationEmailPayload,
  type MagicLinkEmailPayload,
  type PasswordResetEmailPayload,
} from './auth.events.js';

async function recordAndScheduleOutboxEmail(
  data: MailEnqueueInput,
  requestId?: string,
): Promise<void> {
  const mailOutboxId = await recordOutboxEmail(data);
  eventBus.onCommit(() => dispatchOutboxEmail(mailOutboxId, requestId ? { requestId } : undefined));
}

async function handleMagicLinkEmail(
  payload: MagicLinkEmailPayload,
  requestId?: string,
): Promise<void> {
  if (!isMailConfigured()) {
    logger.warn({ email: payload.email }, 'Mail not configured — magic link email skipped');
    return;
  }

  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';
  const magicLinkUrl = `${frontendUrl}/auth/magic-link/verify?token=${payload.magic_link_token}&email=${encodeURIComponent(payload.email)}`;
  const html = magicLinkTemplate({
    magicLinkUrl,
    expiresInMinutes: payload.expires_in_minutes,
  });

  await recordAndScheduleOutboxEmail(
    {
      to: payload.email,
      subject: i18next.t('mail:magicLinkSubject', { lng: 'en' }),
      html,
      tags: [{ name: 'category', value: 'magic-link' }],
    },
    requestId,
  );
}

async function handlePasswordResetEmail(
  payload: PasswordResetEmailPayload,
  requestId?: string,
): Promise<void> {
  if (!isMailConfigured()) {
    logger.warn({ email: payload.email }, 'Mail not configured — password reset email skipped');
    return;
  }

  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/auth/password/reset?token=${payload.reset_token}`;

  await recordAndScheduleOutboxEmail(
    {
      to: payload.email,
      subject: i18next.t('mail:passwordResetSubject', { lng: 'en' }),
      html: i18next.t('mail:passwordResetHtml', {
        lng: 'en',
        resetUrl,
        expiresInMinutes: payload.expires_in_minutes,
      }),
      tags: [{ name: 'category', value: 'password-reset' }],
    },
    requestId,
  );
}

async function handleEmailVerificationEmail(
  payload: EmailVerificationEmailPayload,
  requestId?: string,
): Promise<void> {
  if (!isMailConfigured()) {
    logger.warn({ email: payload.email }, 'Mail not configured — verification email skipped');
    return;
  }

  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';
  const verifyUrl = `${frontendUrl}/auth/email/verify?token=${payload.verification_token}`;

  await recordAndScheduleOutboxEmail(
    {
      to: payload.email,
      subject: i18next.t('mail:emailVerificationSubject', { lng: 'en' }),
      html: i18next.t('mail:emailVerificationHtml', {
        lng: 'en',
        verifyUrl,
        expiresInHours: payload.expires_in_hours,
      }),
      tags: [{ name: 'category', value: 'email-verification' }],
    },
    requestId,
  );
}

async function onMagicLinkEmailEvent(event: DomainEvent): Promise<void> {
  const payload = event.payload as MagicLinkEmailPayload;
  try {
    await handleMagicLinkEmail(payload, event.requestId);
  } catch (error) {
    logger.warn(
      { error, eventType: event.type, email: payload.email },
      'auth.magic_link.email.enqueue.failed',
    );
    throw error;
  }
}

async function onPasswordResetEmailEvent(event: DomainEvent): Promise<void> {
  const payload = event.payload as PasswordResetEmailPayload;
  try {
    await handlePasswordResetEmail(payload, event.requestId);
  } catch (error) {
    logger.warn(
      { error, eventType: event.type, email: payload.email },
      'auth.password_reset.email.enqueue.failed',
    );
    throw error;
  }
}

async function onEmailVerificationEmailEvent(event: DomainEvent): Promise<void> {
  const payload = event.payload as EmailVerificationEmailPayload;
  try {
    await handleEmailVerificationEmail(payload, event.requestId);
  } catch (error) {
    logger.warn(
      { error, eventType: event.type, email: payload.email },
      'auth.email_verification.email.enqueue.failed',
    );
    throw error;
  }
}

let authEventHandlersRegistered = false;

function registerAuthMethodEmailEventHandlers(): void {
  eventBus.on(AUTH_EVENT.MAGIC_LINK_REQUESTED, onMagicLinkEmailEvent);
  eventBus.on(AUTH_EVENT.PASSWORD_RESET_REQUESTED, onPasswordResetEmailEvent);
  eventBus.on(AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED, onEmailVerificationEmailEvent);
}

export function registerAuthMethodEventHandlers(): void {
  if (authEventHandlersRegistered) return;
  authEventHandlersRegistered = true;
  registerAuthMethodEmailEventHandlers();
}
