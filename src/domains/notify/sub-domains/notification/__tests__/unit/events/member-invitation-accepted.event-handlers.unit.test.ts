import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAndDispatchNotificationMock = vi.fn();
vi.mock('@/domains/notify/sub-domains/notification/notification-dispatch.service.js', () => ({
  createAndDispatchNotification: (...arguments_: unknown[]) =>
    createAndDispatchNotificationMock(...arguments_),
}));

describe('member-invitation-accepted notification handler (item #10)', () => {
  beforeEach(() => {
    createAndDispatchNotificationMock.mockReset();
    createAndDispatchNotificationMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  async function emitAccepted(payload: unknown): Promise<void> {
    const { eventBus } = await import('@/core/events/event-bus.js');
    const { MEMBER_INVITATION_EVENT } = await import(
      '@/domains/tenancy/sub-domains/membership/member-invitation/events/member-invitation.events.js'
    );
    const { registerMemberInvitationAcceptedNotificationHandlers } = await import(
      '@/domains/notify/sub-domains/notification/events/member-invitation-accepted.event-handlers.js'
    );
    registerMemberInvitationAcceptedNotificationHandlers();
    await eventBus.emit({ type: MEMBER_INVITATION_EVENT.ACCEPTED, payload, timestamp: new Date() });
  }

  it('fans out one in-app+email notification per manager recipient', async () => {
    await emitAccepted({
      recipient_user_ids: [11, 22],
      organization_id: 7,
      organization_name: 'Acme',
      invitee_name: 'Dana Scully',
    });

    expect(createAndDispatchNotificationMock).toHaveBeenCalledTimes(2);
    expect(createAndDispatchNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 11,
        organization_id: 7,
        type: 'membership.invite_accepted',
        title: 'Invitation accepted',
        message: 'Dana Scully accepted your invitation to join Acme.',
        action_url: '/settings/members',
        data: { channels: ['in_app', 'email'] },
      }),
    );
    expect(createAndDispatchNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 22 }),
    );
  });

  it('one failed dispatch does not drop the rest and never throws out of the handler', async () => {
    createAndDispatchNotificationMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);

    await expect(
      emitAccepted({
        recipient_user_ids: [1, 2],
        organization_id: 7,
        organization_name: 'Acme',
        invitee_name: 'X',
      }),
    ).resolves.not.toThrow();

    expect(createAndDispatchNotificationMock).toHaveBeenCalledTimes(2);
  });
});
