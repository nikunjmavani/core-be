import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterOnCommitScope, eventBus } from '@/core/events/event-bus.js';
import { MEMBER_INVITATION_EVENT } from '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.events.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { registerMemberInvitationEventHandlers } from '../member-invitation.event-handlers.js';

const recordOutboxEmailMock = vi.fn();
const dispatchOutboxEmailMock = vi.fn();

vi.mock('@/infrastructure/mail/queues/mail.queue.js', () => ({
  recordOutboxEmail: (...arguments_: unknown[]) => recordOutboxEmailMock(...arguments_),
  dispatchOutboxEmail: (...arguments_: unknown[]) => dispatchOutboxEmailMock(...arguments_),
}));

vi.mock('@/infrastructure/mail/mail.service.js', () => ({
  isMailConfigured: () => true,
}));

describe('tenancy member-invitation event handlers', () => {
  beforeEach(() => {
    recordOutboxEmailMock.mockReset();
    dispatchOutboxEmailMock.mockReset();
    recordOutboxEmailMock.mockResolvedValue(99);
    dispatchOutboxEmailMock.mockResolvedValue(undefined);
    registerMemberInvitationEventHandlers();
  });

  async function emitAndFlushOnCommit(event: Parameters<typeof eventBus.emit>[0]): Promise<void> {
    enterOnCommitScope();
    await eventBus.emit(event);
    await eventBus.flushOnCommit();
  }

  it('records outbox and dispatches after commit on tenancy.member_invitation.created', async () => {
    await emitAndFlushOnCommit({
      type: MEMBER_INVITATION_EVENT.CREATED,
      payload: {
        email: 'invitee@example.com',
        organization_name: 'Acme Corp',
        inviter_name: 'usr_inviter',
        token: 'secret-token',
        invitation_public_id: 'inv_01test',
        expires_in_days: 7,
      },
      timestamp: new Date(),
    });

    expect(recordOutboxEmailMock).toHaveBeenCalledOnce();
    expect(recordOutboxEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.com',
        subject: "You've been invited to join Acme Corp",
        tags: [{ name: 'category', value: 'invitation' }],
      }),
    );
    expect(dispatchOutboxEmailMock).toHaveBeenCalledOnce();
    expect(dispatchOutboxEmailMock).toHaveBeenCalledWith(99);
  });

  it('records outbox and dispatches after commit on tenancy.member_invitation.resent', async () => {
    await emitAndFlushOnCommit({
      type: MEMBER_INVITATION_EVENT.RESENT,
      payload: {
        email: 'invitee@example.com',
        organization_name: 'Acme Corp',
        inviter_name: 'Team member',
        token: 'secret-token',
        invitation_public_id: 'inv_01test',
        expires_in_days: 14,
      },
      timestamp: new Date(),
    });

    expect(recordOutboxEmailMock).toHaveBeenCalledOnce();
    expect(dispatchOutboxEmailMock).toHaveBeenCalledOnce();
  });

  it('re-throws so the event bus surfaces failure when recordOutboxEmail rejects', async () => {
    const recordError = new Error('outbox write failed');
    recordOutboxEmailMock.mockReset();
    recordOutboxEmailMock.mockRejectedValue(recordError);

    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      await expect(
        emitAndFlushOnCommit({
          type: MEMBER_INVITATION_EVENT.CREATED,
          payload: {
            email: 'invitee@example.com',
            organization_name: 'Acme Corp',
            inviter_name: 'usr_inviter',
            token: 'secret-token',
            invitation_public_id: 'inv_01test',
            expires_in_days: 7,
          },
          timestamp: new Date(),
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: recordError,
          eventType: MEMBER_INVITATION_EVENT.CREATED,
        }),
        'member-invitation.email.enqueue.failed',
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: recordError,
          eventType: MEMBER_INVITATION_EVENT.CREATED,
        }),
        'Domain event handler failed',
      );
      expect(dispatchOutboxEmailMock).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
