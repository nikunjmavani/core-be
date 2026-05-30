import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processNotificationDispatchJob } from '@/domains/notify/sub-domains/notification/workers/notification.worker.js';
import type { NotificationRepository } from '@/domains/notify/sub-domains/notification/notification.repository.js';

const recordOutboxEmailMock = vi.fn();
const dispatchOutboxEmailMock = vi.fn();
const isMailConfiguredMock = vi.fn();

vi.mock('@/infrastructure/mail/queues/mail.queue.js', () => ({
  recordOutboxEmail: (...parameters: unknown[]) => recordOutboxEmailMock(...parameters),
  dispatchOutboxEmail: (...parameters: unknown[]) => dispatchOutboxEmailMock(...parameters),
}));

vi.mock('@/infrastructure/database/contexts/worker-database.context.js', () => ({
  withSystemTableWorkerContext: (callback: () => Promise<unknown>) => callback(),
}));

vi.mock('@/infrastructure/mail/mail.service.js', () => ({
  isMailConfigured: () => isMailConfiguredMock(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createNotificationRepository(row: unknown): NotificationRepository {
  return {
    findByIdForDispatch: vi.fn().mockResolvedValue(row),
  } as unknown as NotificationRepository;
}

function buildNotificationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 10,
    type: 'billing.invoice_ready',
    title: 'Invoice ready',
    message: 'Your invoice is ready.',
    actionUrl: 'https://app.example.com/invoices/1',
    userEmail: 'user@example.com',
    data: { channels: ['email', 'in_app'] },
    ...overrides,
  };
}

describe('notification.worker', () => {
  beforeEach(() => {
    recordOutboxEmailMock.mockReset();
    dispatchOutboxEmailMock.mockReset();
    isMailConfiguredMock.mockReset();
    isMailConfiguredMock.mockReturnValue(true);
    recordOutboxEmailMock.mockResolvedValue(501);
    dispatchOutboxEmailMock.mockResolvedValue(undefined);
  });

  it('queues email and returns in-app channel result when both channels are requested', async () => {
    const repository = createNotificationRepository(buildNotificationRow());

    const result = await processNotificationDispatchJob(
      10,
      'organization_public_id',
      { id: 'job-1', requestId: 'request-1' },
      repository,
    );

    expect(recordOutboxEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Invoice ready',
        tags: [{ name: 'category', value: 'notification-billing.invoice_ready' }],
      }),
    );
    expect(dispatchOutboxEmailMock).toHaveBeenCalledWith(501, { requestId: 'request-1' });
    expect(result).toEqual({ channels: ['email:queued', 'in_app:persisted'] });
  });

  it('escapes untrusted notification fields and drops unsafe action URLs in the email HTML', async () => {
    const repository = createNotificationRepository(
      buildNotificationRow({
        title: '<script>alert(1)</script>',
        message: 'Hello <img src=x onerror=alert(1)>',
        actionUrl: 'javascript:alert(document.cookie)',
      }),
    );

    await processNotificationDispatchJob(
      10,
      'organization_public_id',
      { id: 'job-1', requestId: 'request-1' },
      repository,
    );

    const emailPayload = recordOutboxEmailMock.mock.calls[0]?.[0] as { html: string };
    expect(emailPayload.html).not.toContain('<script>alert(1)</script>');
    expect(emailPayload.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(emailPayload.html).not.toContain('<img src=x');
    expect(emailPayload.html).not.toContain('href="javascript:');
    expect(emailPayload.html).not.toContain('class="button"');
  });

  it('skips email channel when mail is not configured', async () => {
    isMailConfiguredMock.mockReturnValue(false);
    const repository = createNotificationRepository(buildNotificationRow());

    const result = await processNotificationDispatchJob(
      10,
      'organization_public_id',
      { id: 'job-1' },
      repository,
    );

    expect(recordOutboxEmailMock).not.toHaveBeenCalled();
    expect(dispatchOutboxEmailMock).not.toHaveBeenCalled();
    expect(result).toEqual({ channels: ['in_app:persisted'] });
  });

  it('defaults to in-app delivery when channels are absent', async () => {
    const repository = createNotificationRepository(buildNotificationRow({ data: {} }));

    const result = await processNotificationDispatchJob(10, null, { id: 'job-1' }, repository);

    expect(recordOutboxEmailMock).not.toHaveBeenCalled();
    expect(result).toEqual({ channels: ['in_app:persisted'] });
  });

  it('throws when the notification cannot be loaded', async () => {
    const repository = createNotificationRepository(null);

    await expect(
      processNotificationDispatchJob(999, null, { id: 'job-1' }, repository),
    ).rejects.toThrow('notification.not_found:999');
  });
});
