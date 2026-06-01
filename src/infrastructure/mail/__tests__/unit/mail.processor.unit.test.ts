import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { MAIL_QUEUE_MAX_ATTEMPTS } from '@/infrastructure/mail/queues/mail.queue.js';
import {
  buildMailOutboxIdempotencyKey,
  processMailOutboxJob,
} from '@/infrastructure/mail/workers/mail.processor.js';

const findMailOutboxByIdMock = vi.fn();
const tryClaimPendingMailOutboxMock = vi.fn();
const markMailOutboxSentMock = vi.fn();
const markMailOutboxFailedMock = vi.fn();
const releaseMailOutboxClaimMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock('@/infrastructure/mail/mail-outbox.repository.js', () => ({
  findMailOutboxById: (...arguments_: unknown[]) => findMailOutboxByIdMock(...arguments_),
  tryClaimPendingMailOutbox: (...arguments_: unknown[]) =>
    tryClaimPendingMailOutboxMock(...arguments_),
  markMailOutboxSent: (...arguments_: unknown[]) => markMailOutboxSentMock(...arguments_),
  markMailOutboxFailed: (...arguments_: unknown[]) => markMailOutboxFailedMock(...arguments_),
  releaseMailOutboxClaim: (...arguments_: unknown[]) => releaseMailOutboxClaimMock(...arguments_),
}));

vi.mock('@/infrastructure/mail/mail.service.js', () => ({
  sendEmail: (...arguments_: unknown[]) => sendEmailMock(...arguments_),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('mail.processor', () => {
  beforeEach(() => {
    findMailOutboxByIdMock.mockReset();
    tryClaimPendingMailOutboxMock.mockReset();
    markMailOutboxSentMock.mockReset();
    markMailOutboxFailedMock.mockReset();
    releaseMailOutboxClaimMock.mockReset();
    sendEmailMock.mockReset();
  });

  it('buildMailOutboxIdempotencyKey is deterministic per outbox row', () => {
    expect(buildMailOutboxIdempotencyKey(43)).toBe('mail-outbox-43');
    expect(buildMailOutboxIdempotencyKey(43)).toBe(buildMailOutboxIdempotencyKey(43));
  });

  it('processMailOutboxJob skips send when outbox row is already sent', async () => {
    tryClaimPendingMailOutboxMock.mockResolvedValue('already_sent');
    findMailOutboxByIdMock.mockResolvedValue({
      id: 42,
      status: 'sent',
      resend_message_id: 'msg_existing',
      to_addresses: ['user@example.com'],
    });

    const result = await processMailOutboxJob({ mailOutboxId: 42 });

    expect(result).toEqual({ messageId: 'msg_existing', skipped: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(markMailOutboxSentMock).not.toHaveBeenCalled();
  });

  it('processMailOutboxJob sends and marks row sent when pending', async () => {
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    tryClaimPendingMailOutboxMock.mockResolvedValue('claimed');
    findMailOutboxByIdMock.mockResolvedValue({
      id: 43,
      status: 'sending',
      to_addresses: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text_body: null,
      reply_to: null,
      tags: null,
    });
    sendEmailMock.mockResolvedValue('msg_new');

    const result = await processMailOutboxJob(
      { mailOutboxId: 43, requestId: 'req-mail-43' },
      { jobId: 'job-43', requestId: 'req-mail-43' },
    );

    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'mail-outbox-43' }),
    );
    expect(markMailOutboxSentMock).toHaveBeenCalledWith(43, 'msg_new');
    expect(result).toEqual({ messageId: 'msg_new' });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-mail-43',
        mailOutboxId: 43,
        resendMessageId: 'msg_new',
      }),
      'email.sent',
    );
  });

  it('processMailOutboxJob releases claim on non-final send failure', async () => {
    tryClaimPendingMailOutboxMock.mockResolvedValue('claimed');
    findMailOutboxByIdMock.mockResolvedValue({
      id: 44,
      status: 'sending',
      to_addresses: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text_body: null,
      reply_to: null,
      tags: null,
    });
    sendEmailMock.mockRejectedValue(new Error('resend.down'));

    await expect(
      processMailOutboxJob({ mailOutboxId: 44 }, { jobAttemptNumber: 0, maxJobAttempts: 3 }),
    ).rejects.toThrow('resend.down');

    expect(releaseMailOutboxClaimMock).toHaveBeenCalledWith(44);
    expect(markMailOutboxFailedMock).not.toHaveBeenCalled();
  });

  it('processMailOutboxJob releases claim on final circuit-open failure without marking failed', async () => {
    tryClaimPendingMailOutboxMock.mockResolvedValue('claimed');
    findMailOutboxByIdMock.mockResolvedValue({
      id: 46,
      status: 'sending',
      to_addresses: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text_body: null,
      reply_to: null,
      tags: null,
    });
    sendEmailMock.mockRejectedValue(
      new CircuitBreakerOpenError('resend', 60_000, 'Circuit breaker "resend" is OPEN'),
    );

    await expect(
      processMailOutboxJob(
        { mailOutboxId: 46 },
        { jobAttemptNumber: MAIL_QUEUE_MAX_ATTEMPTS - 1, maxJobAttempts: MAIL_QUEUE_MAX_ATTEMPTS },
      ),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    expect(releaseMailOutboxClaimMock).toHaveBeenCalledWith(46);
    expect(markMailOutboxFailedMock).not.toHaveBeenCalled();
  });

  it('processMailOutboxJob marks failed on final send failure', async () => {
    tryClaimPendingMailOutboxMock.mockResolvedValue('claimed');
    findMailOutboxByIdMock.mockResolvedValue({
      id: 45,
      status: 'sending',
      to_addresses: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text_body: null,
      reply_to: null,
      tags: null,
    });
    sendEmailMock.mockRejectedValue(new Error('resend.down'));

    await expect(
      processMailOutboxJob({ mailOutboxId: 45 }, { jobAttemptNumber: 2, maxJobAttempts: 3 }),
    ).rejects.toThrow('resend.down');

    expect(markMailOutboxFailedMock).toHaveBeenCalledWith(45);
    expect(releaseMailOutboxClaimMock).not.toHaveBeenCalled();
  });
});
