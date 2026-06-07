import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

vi.mock('@/domains/tenancy/sub-domains/permission/permission-cache.service.js', () => ({
  invalidatePermissions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/events/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/shared/utils/text/email.util.js', () => ({
  isDisposableEmailBlocked: vi.fn().mockReturnValue(false),
}));

vi.mock(
  '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.token.js',
  () => ({
    generateInvitationToken: vi.fn().mockReturnValue('raw-token-abc123'),
    hashInvitationToken: vi.fn().mockReturnValue('hashed-token-abc123'),
  }),
);

import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConfigurationError,
} from '@/shared/errors/index.js';
import { MemberInvitationService } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.service.js';
import { isDisposableEmailBlocked } from '@/shared/utils/text/email.util.js';
import { eventBus } from '@/core/events/event-bus.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import type { MemberInvitationRepository } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.repository.js';
import type { UserService } from '@/domains/user/user.service.js';

const now = new Date('2026-06-01T00:00:00.000Z');
const futureDate = new Date('2026-06-15T00:00:00.000Z');
const organization = { id: 1, public_id: 'org_public_abc', name: 'Test Org' };
const membership = { id: 10, public_id: 'mem_public_xyz', organization_id: 1, user_id: 5 };

function makeInvitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    public_id: 'inv_public_123',
    membership_id: 10,
    email: 'invitee@example.com',
    token_hash: 'hashed-token-abc123',
    invited_by_user_id: 2,
    expires_at: futureDate,
    accepted_at: null,
    revoked_at: null,
    created_at: now,
    ...overrides,
  };
}

describe('MemberInvitationService', () => {
  const organizationRepository = {
    findByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserIdByPublicId: vi.fn().mockResolvedValue(2),
    resolveUserPublicIdByInternalId: vi.fn().mockResolvedValue('user_public_id'),
  } as unknown as OrganizationRepository;

  const membershipRepository = {
    findByPublicId: vi.fn().mockResolvedValue(membership),
    findById: vi.fn().mockResolvedValue(membership),
    activateForInvitationAccept: vi.fn().mockResolvedValue(membership),
  } as unknown as MembershipRepository;

  const invitationRepository = {
    findByOrganizationId: vi.fn().mockResolvedValue({
      items: [
        {
          ...makeInvitationRow(),
          membership_public_id: 'mem_public_xyz',
        },
      ],
      total: null,
      limit: 25,
      has_more: false,
      next_cursor: null,
    }),
    findByPublicId: vi.fn().mockResolvedValue(makeInvitationRow()),
    lookupOrganizationByInvitationPublicId: vi.fn().mockResolvedValue({
      organization_public_id: 'org_public_abc',
      organization_id: 1,
      membership_id: 10,
      membership_public_id: 'mem_public_xyz',
    }),
    create: vi.fn().mockResolvedValue(makeInvitationRow()),
    accept: vi.fn().mockResolvedValue(makeInvitationRow({ accepted_at: now })),
    revoke: vi.fn().mockResolvedValue(makeInvitationRow({ revoked_at: now })),
    resend: vi.fn().mockResolvedValue(makeInvitationRow()),
    findByEmailPending: vi.fn().mockResolvedValue([]),
  } as unknown as MemberInvitationRepository;

  const userService = {
    findUserRecordByPublicId: vi.fn().mockResolvedValue({
      id: 5,
      public_id: 'user_public_id',
      email: 'invitee@example.com',
    }),
    // sec-T4: accept now requires acting user's email to match invitee email.
    requireUserRecordByPublicId: vi.fn().mockResolvedValue({
      id: 5,
      public_id: 'user_public_id',
      email: 'invitee@example.com',
    }),
  } as unknown as UserService;

  const service = new MemberInvitationService(
    organizationRepository,
    membershipRepository,
    invitationRepository,
    userService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(organization as never);
    vi.mocked(membershipRepository.findByPublicId).mockResolvedValue(membership as never);
    vi.mocked(membershipRepository.findById).mockResolvedValue(membership as never);
    vi.mocked(membershipRepository.activateForInvitationAccept).mockResolvedValue(
      membership as never,
    );
    vi.mocked(organizationRepository.resolveUserIdByPublicId).mockResolvedValue(2);
    vi.mocked(organizationRepository.resolveUserPublicIdByInternalId).mockResolvedValue(
      'user_public_id',
    );
    vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(makeInvitationRow() as never);
    vi.mocked(invitationRepository.lookupOrganizationByInvitationPublicId).mockResolvedValue({
      organization_public_id: 'org_public_abc',
      organization_id: 1,
      membership_id: 10,
      membership_public_id: 'mem_public_xyz',
    } as never);
    vi.mocked(invitationRepository.create).mockResolvedValue(makeInvitationRow() as never);
    vi.mocked(invitationRepository.accept).mockResolvedValue(
      makeInvitationRow({ accepted_at: now }) as never,
    );
    vi.mocked(invitationRepository.revoke).mockResolvedValue(
      makeInvitationRow({ revoked_at: now }) as never,
    );
    vi.mocked(invitationRepository.resend).mockResolvedValue(makeInvitationRow() as never);
    vi.mocked(invitationRepository.findByOrganizationId).mockResolvedValue({
      items: [{ ...makeInvitationRow(), membership_public_id: 'mem_public_xyz' }],
      total: null,
      limit: 25,
      has_more: false,
      next_cursor: null,
    } as never);
    vi.mocked(invitationRepository.findByEmailPending).mockResolvedValue([]);
    vi.mocked(isDisposableEmailBlocked).mockReturnValue(false);
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue({
      id: 5,
      public_id: 'user_public_id',
      email: 'invitee@example.com',
    } as never);
    vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue({
      id: 5,
      public_id: 'user_public_id',
      email: 'invitee@example.com',
    } as never);
  });

  describe('list', () => {
    it('returns paginated invitation list', async () => {
      const result = await service.list({
        organization_public_id: 'org_public_abc',
        query: { limit: '25' },
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ email: 'invitee@example.com' });
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(
        service.list({ organization_public_id: 'org_public_abc', query: {} }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('create', () => {
    const body = {
      membership_id: 'mem_public_xyz',
      expires_in_days: 7,
    };

    beforeEach(() => {
      vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValue({
        id: 5,
        public_id: 'user_public_id',
        email: 'derived-from-membership@example.com',
      } as never);
    });

    it('creates invitation and emits event', async () => {
      const result = await service.create('org_public_abc', body, 'inviter_public');
      expect(invitationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'derived-from-membership@example.com' }),
      );
      expect(eventBus.emit).toHaveBeenCalledOnce();
      expect(result.token).toBe('raw-token-abc123');
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.create('org_public_abc', body, 'inviter_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when membership is missing', async () => {
      vi.mocked(membershipRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.create('org_public_abc', body, 'inviter_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when inviter user cannot be resolved', async () => {
      vi.mocked(organizationRepository.resolveUserIdByPublicId).mockResolvedValue(null);
      await expect(service.create('org_public_abc', body, 'unknown_user')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws ConfigurationError when userService is not wired', async () => {
      const serviceWithoutUserService = new MemberInvitationService(
        organizationRepository,
        membershipRepository,
        invitationRepository,
      );
      await expect(
        serviceWithoutUserService.create('org_public_abc', body, 'inviter_public'),
      ).rejects.toBeInstanceOf(ConfigurationError);
    });

    it('throws ValidationError when membership user email is on a disposable domain', async () => {
      vi.mocked(isDisposableEmailBlocked).mockReturnValue(true);
      await expect(service.create('org_public_abc', body, 'inviter_public')).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(isDisposableEmailBlocked).toHaveBeenCalledWith('derived-from-membership@example.com');
    });

    it('throws NotFoundError when membership user public id cannot be resolved', async () => {
      vi.mocked(organizationRepository.resolveUserPublicIdByInternalId).mockResolvedValueOnce(null);
      await expect(service.create('org_public_abc', body, 'inviter_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('accept', () => {
    const body = { token: 'raw-token-abc123' };

    it('accepts invitation and activates membership', async () => {
      const result = await service.accept('inv_public_123', body, 'user_public_id');
      expect(invitationRepository.accept).toHaveBeenCalled();
      expect(membershipRepository.activateForInvitationAccept).toHaveBeenCalled();
      expect(result).toMatchObject({ email: 'invitee@example.com' });
    });

    it('throws ForbiddenError when acting user email does not match invitee (sec-T4)', async () => {
      vi.mocked(userService.requireUserRecordByPublicId).mockResolvedValueOnce({
        id: 99,
        public_id: 'user_attacker',
        email: 'attacker@example.com',
      } as never);
      await expect(service.accept('inv_public_123', body, 'user_attacker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
    });

    it('throws NotFoundError when lookup returns null', async () => {
      vi.mocked(invitationRepository.lookupOrganizationByInvitationPublicId).mockResolvedValue(
        null,
      );
      await expect(service.accept('missing_inv', body, 'user_public_id')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when invitation row is missing', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.accept('inv_public_123', body, 'user_public_id')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws ValidationError when invitation is already revoked', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(
        makeInvitationRow({ revoked_at: now }) as never,
      );
      await expect(service.accept('inv_public_123', body, 'user_public_id')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('throws ValidationError when invitation is already accepted', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(
        makeInvitationRow({ accepted_at: now }) as never,
      );
      await expect(service.accept('inv_public_123', body, 'user_public_id')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('throws ValidationError when invitation is expired', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(
        makeInvitationRow({ expires_at: new Date('2020-01-01T00:00:00.000Z') }) as never,
      );
      await expect(service.accept('inv_public_123', body, 'user_public_id')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('revoke', () => {
    it('revokes the invitation', async () => {
      await service.revoke('org_public_abc', 'inv_public_123');
      expect(invitationRepository.revoke).toHaveBeenCalledWith('inv_public_123');
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.revoke('org_public_abc', 'inv_public_123')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when invitation is missing', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.revoke('org_public_abc', 'inv_public_123')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when revoke returns null', async () => {
      vi.mocked(invitationRepository.revoke).mockResolvedValue(null);
      await expect(service.revoke('org_public_abc', 'inv_public_123')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('resend', () => {
    const body = { expires_in_days: 7 };

    it('resends invitation with new token and emits event', async () => {
      const result = await service.resend('org_public_abc', 'inv_public_123', body);
      expect(invitationRepository.resend).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledOnce();
      expect(result.token).toBe('raw-token-abc123');
    });

    it('throws NotFoundError when invitation is missing', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.resend('org_public_abc', 'inv_public_123', body)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws ValidationError when invitation is already accepted', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(
        makeInvitationRow({ accepted_at: now }) as never,
      );
      await expect(service.resend('org_public_abc', 'inv_public_123', body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('throws ValidationError when invitation is revoked', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(
        makeInvitationRow({ revoked_at: now }) as never,
      );
      await expect(service.resend('org_public_abc', 'inv_public_123', body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('listPendingInvitations', () => {
    it('returns pending invitations for a user', async () => {
      vi.mocked(invitationRepository.findByEmailPending).mockResolvedValue([
        {
          invitation_public_id: 'inv_public_123',
          invitation_email: 'invitee@example.com',
          invitation_expires_at: futureDate,
          invitation_created_at: now,
          membership_id: 10,
          membership_public_id: 'mem_public_xyz',
        },
      ] as never);
      const result = await service.listPendingInvitations('user_public_id');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ email: 'invitee@example.com' });
    });

    it('throws NotFoundError when user is missing', async () => {
      vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
      await expect(service.listPendingInvitations('unknown_user')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws ConfigurationError when userService is not configured', async () => {
      const serviceWithoutUserService = new MemberInvitationService(
        organizationRepository,
        membershipRepository,
        invitationRepository,
      );
      await expect(
        serviceWithoutUserService.listPendingInvitations('user_public_id'),
      ).rejects.toBeInstanceOf(ConfigurationError);
    });
  });

  describe('decline', () => {
    it('declines invitation by revoking it when emails match', async () => {
      await service.decline('inv_public_123', 'user_public_id');
      expect(invitationRepository.revoke).toHaveBeenCalledWith('inv_public_123');
    });

    it('throws ForbiddenError when email does not match authenticated user', async () => {
      vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue({
        id: 5,
        public_id: 'user_public_id',
        email: 'different@example.com',
      } as never);
      await expect(service.decline('inv_public_123', 'user_public_id')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('throws NotFoundError when user is missing', async () => {
      vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
      await expect(service.decline('inv_public_123', 'user_public_id')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws ConfigurationError when userService is not configured', async () => {
      const serviceWithoutUserService = new MemberInvitationService(
        organizationRepository,
        membershipRepository,
        invitationRepository,
      );
      await expect(
        serviceWithoutUserService.decline('inv_public_123', 'user_public_id'),
      ).rejects.toBeInstanceOf(ConfigurationError);
    });

    it('throws ValidationError when invitation is already accepted', async () => {
      vi.mocked(invitationRepository.findByPublicId).mockResolvedValue(
        makeInvitationRow({ accepted_at: now }) as never,
      );
      await expect(service.decline('inv_public_123', 'user_public_id')).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
