import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import Backend from 'i18next-fs-backend';
import i18next from 'i18next';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import { AUTH_EVENT } from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { registerAuthMethodEventHandlers } from '@/domains/auth/sub-domains/auth-method/events/auth.event-handlers.js';
import { isMailConfigured } from '@/infrastructure/mail/mail.service.js';
import { ServiceUnavailableError } from '@/shared/errors/index.js';

const recordOutboxEmailMock = vi.fn();
const dispatchOutboxEmailMock = vi.fn();

vi.mock('@/infrastructure/mail/queues/mail.queue.js', () => ({
  recordOutboxEmail: (...arguments_: unknown[]) => recordOutboxEmailMock(...arguments_),
  dispatchOutboxEmail: (...arguments_: unknown[]) => dispatchOutboxEmailMock(...arguments_),
}));

vi.mock('@/infrastructure/mail/mail.service.js', () => ({
  isMailConfigured: vi.fn(() => true),
}));

describe('auth event handlers', () => {
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
    recordOutboxEmailMock.mockReset();
    dispatchOutboxEmailMock.mockReset();
    recordOutboxEmailMock.mockResolvedValue(42);
    dispatchOutboxEmailMock.mockResolvedValue(undefined);
    vi.mocked(isMailConfigured).mockReturnValue(true);
    registerAuthMethodEventHandlers();
  });

  async function emitAndFlushOnCommit(event: Parameters<typeof eventBus.emit>[0]): Promise<void> {
    enterOnCommitScope();
    await eventBus.emit(event);
    await eventBus.flushOnCommit();
  }

  it('records outbox and dispatches after commit on auth.magic_link.requested', async () => {
    await emitAndFlushOnCommit({
      type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
      payload: {
        email: 'user@example.com',
        otp_code: '123456',
        expires_in_minutes: 15,
      },
      timestamp: new Date(),
    });

    expect(recordOutboxEmailMock).toHaveBeenCalledOnce();
    expect(recordOutboxEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Sign in to your account',
        tags: [{ name: 'category', value: 'magic-link' }],
      }),
    );
    expect(dispatchOutboxEmailMock).toHaveBeenCalledOnce();
    expect(dispatchOutboxEmailMock).toHaveBeenCalledWith(42);
  });

  it('records outbox and dispatches after commit on auth.password_reset.requested', async () => {
    await emitAndFlushOnCommit({
      type: AUTH_EVENT.PASSWORD_RESET_REQUESTED,
      payload: {
        email: 'user@example.com',
        reset_token: 'reset-token',
        expires_in_minutes: 60,
      },
      timestamp: new Date(),
    });

    expect(recordOutboxEmailMock).toHaveBeenCalledOnce();
    expect(recordOutboxEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Reset your password',
        tags: [{ name: 'category', value: 'password-reset' }],
      }),
    );
    expect(dispatchOutboxEmailMock).toHaveBeenCalledOnce();
  });

  it('records outbox and dispatches after commit on auth.email_verification.requested', async () => {
    await emitAndFlushOnCommit({
      type: AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED,
      payload: {
        email: 'user@example.com',
        otp_code: '123456',
        expires_in_minutes: 15,
      },
      timestamp: new Date(),
    });

    expect(recordOutboxEmailMock).toHaveBeenCalledOnce();
    expect(recordOutboxEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Verify your email address',
        tags: [{ name: 'category', value: 'email-verification' }],
      }),
    );
    expect(dispatchOutboxEmailMock).toHaveBeenCalledOnce();
  });

  it('does not dispatch BullMQ job until flushOnCommit runs', async () => {
    enterOnCommitScope();
    await eventBus.emit({
      type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
      payload: {
        email: 'user@example.com',
        otp_code: '123456',
        expires_in_minutes: 15,
      },
      timestamp: new Date(),
    });

    expect(recordOutboxEmailMock).toHaveBeenCalledOnce();
    expect(dispatchOutboxEmailMock).not.toHaveBeenCalled();

    await eventBus.flushOnCommit();
    expect(dispatchOutboxEmailMock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      AUTH_EVENT.MAGIC_LINK_REQUESTED,
      { email: 'user@example.com', otp_code: '123456', expires_in_minutes: 15 },
    ],
    [
      AUTH_EVENT.PASSWORD_RESET_REQUESTED,
      { email: 'user@example.com', reset_token: 'reset', expires_in_minutes: 60 },
    ],
    [
      AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED,
      {
        email: 'user@example.com',
        otp_code: '123456',
        expires_in_minutes: 15,
      },
    ],
  ])('throws when mail is not configured for %s', async (eventType, payload) => {
    vi.mocked(isMailConfigured).mockReturnValue(false);

    enterOnCommitScope();
    await expect(
      eventBus.emitStrict({ type: eventType, payload, timestamp: new Date() }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(recordOutboxEmailMock).not.toHaveBeenCalled();
  });

  describe('when recordOutboxEmail rejects', () => {
    const recordError = new Error('outbox write failed');

    beforeEach(() => {
      recordOutboxEmailMock.mockReset();
      recordOutboxEmailMock.mockRejectedValue(recordError);
    });

    it.each([
      [
        AUTH_EVENT.MAGIC_LINK_REQUESTED,
        {
          email: 'user@example.com',
          otp_code: '123456',
          expires_in_minutes: 15,
        },
      ],
      [
        AUTH_EVENT.PASSWORD_RESET_REQUESTED,
        {
          email: 'user@example.com',
          reset_token: 'reset-token',
          expires_in_minutes: 60,
        },
      ],
      [
        AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED,
        {
          email: 'user@example.com',
          otp_code: '123456',
          expires_in_minutes: 15,
        },
      ],
    ])('re-throws so the event bus surfaces the failure for %s', async (eventType, payload) => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      try {
        await expect(
          emitAndFlushOnCommit({ type: eventType, payload, timestamp: new Date() }),
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({ error: recordError, eventType }),
          expect.stringMatching(/\.email\.enqueue\.failed$/),
        );
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ error: recordError, eventType }),
          'Domain event handler failed',
        );
        expect(dispatchOutboxEmailMock).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});
