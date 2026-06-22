/**
 * API requestId must flow: domain event → recordOutboxEmail → dispatchOutboxEmail → mail worker logs (email.sent).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import Backend from 'i18next-fs-backend';
import i18next from 'i18next';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import { AUTH_EVENT } from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import { registerAuthMethodEventHandlers } from '@/domains/auth/sub-domains/auth-method/events/auth.event-handlers.js';
import { processMailOutboxJob } from '@/infrastructure/mail/workers/mail.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const enqueueMailOutboxJobMock = vi.fn();
const findMailOutboxByIdMock = vi.fn();
const tryClaimPendingMailOutboxMock = vi.fn();
const markMailOutboxSentMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock('@/infrastructure/mail/queues/mail.queue.js', () => ({
  MAIL_QUEUE_NAME: 'mail',
  MAIL_QUEUE_MAX_ATTEMPTS: 8,
  recordOutboxEmail: vi.fn().mockResolvedValue(501),
  dispatchOutboxEmail: async (mailOutboxId: number, options?: { requestId?: string }) => {
    await enqueueMailOutboxJobMock(mailOutboxId, options);
  },
  enqueueMailOutboxJob: (...arguments_: unknown[]) => enqueueMailOutboxJobMock(...arguments_),
}));

vi.mock('@/infrastructure/mail/mail-outbox.repository.js', () => ({
  insertMailOutbox: vi.fn().mockResolvedValue(501),
  findMailOutboxById: (...arguments_: unknown[]) => findMailOutboxByIdMock(...arguments_),
  tryClaimPendingMailOutbox: (...arguments_: unknown[]) =>
    tryClaimPendingMailOutboxMock(...arguments_),
  markMailOutboxSent: (...arguments_: unknown[]) => markMailOutboxSentMock(...arguments_),
  markMailOutboxFailed: vi.fn(),
}));

vi.mock('@/infrastructure/mail/mail.service.js', () => ({
  isMailConfigured: () => true,
  sendEmail: (...arguments_: unknown[]) => sendEmailMock(...arguments_),
}));

describe('Request id event-bus to mail worker contract', () => {
  const correlationRequestId = 'req-api-magic-link-correlation';
  const loggerInfoSpy = vi.spyOn(logger, 'info');

  beforeAll(async () => {
    await i18next.use(Backend).init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['mail'],
      defaultNS: 'mail',
      backend: {
        loadPath: join(process.cwd(), 'src/shared/locales/{{lng}}/{{ns}}.json'),
      },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    registerAuthMethodEventHandlers();
    findMailOutboxByIdMock.mockResolvedValue({
      id: 501,
      status: 'pending',
      to_addresses: ['user@example.com'],
      subject: 'Sign in',
      html: '<p>Link</p>',
      text_body: null,
      reply_to: null,
      tags: null,
    });
    sendEmailMock.mockResolvedValue('msg_correlation');
    tryClaimPendingMailOutboxMock.mockResolvedValue('claimed');
    markMailOutboxSentMock.mockResolvedValue(undefined);
  });

  it('propagates requestId from domain event through enqueue into email.sent worker log', async () => {
    enterOnCommitScope();
    await eventBus.emit({
      type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
      payload: {
        email: 'user@example.com',
        otp_code: '123456',
        expires_in_minutes: 15,
      },
      timestamp: new Date(),
      requestId: correlationRequestId,
    });
    await eventBus.flushOnCommit();

    expect(enqueueMailOutboxJobMock).toHaveBeenCalledWith(
      501,
      expect.objectContaining({ requestId: correlationRequestId }),
    );

    await processMailOutboxJob(
      { mailOutboxId: 501, requestId: correlationRequestId },
      { jobId: 'job-mail-correlation', requestId: correlationRequestId },
    );

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: correlationRequestId,
        mailOutboxId: 501,
        resendMessageId: 'msg_correlation',
      }),
      'email.sent',
    );
  });
});
