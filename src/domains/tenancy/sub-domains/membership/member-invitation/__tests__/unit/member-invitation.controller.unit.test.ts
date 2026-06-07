import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createMemberInvitationController } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { ValidationError } from '@/shared/errors/index.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { userId: generatePublicId(), role: 'USER' },
    params: {},
    body: {},
    query: {},
    headers: {},
    id: 'request-id',
    ...overrides,
  } as FastifyRequest;
}

function mockReply(): FastifyReply {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

describe('createMemberInvitationController (cursor pagination)', () => {
  const organizationPublicId = generatePublicId();
  const invitationPublicId = generatePublicId();
  const invitation = { id: invitationPublicId, email: 'invite@example.com' };

  const service = {
    list: vi.fn().mockResolvedValue({
      items: [invitation],
      total: null,
      limit: 25,
      has_more: false,
      next_cursor: null,
    }),
    create: vi.fn().mockResolvedValue({ invitation, token: 'tok' }),
    accept: vi.fn().mockResolvedValue(invitation),
    revoke: vi.fn().mockResolvedValue(undefined),
    resend: vi.fn().mockResolvedValue({ invitation, token: 'tok' }),
    listPendingInvitations: vi.fn().mockResolvedValue([invitation]),
    decline: vi.fn().mockResolvedValue(undefined),
  };

  const controller = createMemberInvitationController(service as never);

  it('listMemberInvitations forwards organization and query to the service', async () => {
    await controller.listMemberInvitations(
      mockRequest({
        params: { id: organizationPublicId },
        query: { after: 'cursor-1', limit: '5', include_total: 'true' },
      }),
      mockReply(),
    );
    expect(service.list).toHaveBeenCalledWith({
      organization_public_id: organizationPublicId,
      query: { after: 'cursor-1', limit: '5', include_total: 'true' },
    });
  });

  it('listMemberInvitations sets next=next_cursor and has_more=true for keyset pagination', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [invitation, invitation],
      total: null,
      limit: 2,
      has_more: true,
      next_cursor: 'opaque-invitation-cursor',
    });

    const response = await controller.listMemberInvitations(
      mockRequest({
        params: { id: organizationPublicId },
        query: { limit: '2' },
      }),
      mockReply(),
    );

    expect(response).toMatchObject({
      meta: {
        pagination: expect.objectContaining({
          has_more: true,
          next: 'opaque-invitation-cursor',
          per_page: 2,
        }),
      },
    });
    expect(
      (response as { meta: { pagination: Record<string, unknown> } }).meta.pagination,
    ).not.toHaveProperty('estimated_total');
  });

  it('listMemberInvitations clears next when no more pages remain', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [invitation],
      total: null,
      limit: 25,
      has_more: false,
      next_cursor: null,
    });
    const response = await controller.listMemberInvitations(
      mockRequest({ params: { id: organizationPublicId } }),
      mockReply(),
    );
    expect(response).toMatchObject({
      meta: { pagination: expect.objectContaining({ has_more: false, next: null, per_page: 25 }) },
    });
  });

  it('listMemberInvitations exposes estimated_total when keyset is combined with include_total', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [invitation],
      total: 1,
      limit: 25,
      has_more: false,
      next_cursor: null,
    });
    const response = await controller.listMemberInvitations(
      mockRequest({
        params: { id: organizationPublicId },
        query: { include_total: 'true' },
      }),
      mockReply(),
    );
    expect(response).toMatchObject({
      meta: {
        pagination: expect.objectContaining({ estimated_total: 1, has_more: false, next: null }),
      },
    });
  });
});

// sec-new-T2: invitationId path-param validation
describe('createMemberInvitationController — invitationId path-param validation (sec-new-T2)', () => {
  const organizationPublicId = generatePublicId();
  const invitationPublicId = generatePublicId();
  const invitation = { id: invitationPublicId, email: 'invite@example.com' };

  const service = {
    list: vi
      .fn()
      .mockResolvedValue({ items: [], total: null, limit: 25, has_more: false, next_cursor: null }),
    create: vi.fn().mockResolvedValue({ invitation, token: 'tok' }),
    accept: vi.fn().mockResolvedValue(invitation),
    revoke: vi.fn().mockResolvedValue(undefined),
    resend: vi.fn().mockResolvedValue({ invitation, token: 'tok' }),
    listPendingInvitations: vi.fn().mockResolvedValue([invitation]),
    decline: vi.fn().mockResolvedValue(undefined),
  };

  const controller = createMemberInvitationController(service as never);

  function mockUserRequest(params: Record<string, string>): FastifyRequest {
    return {
      auth: { kind: 'user', userId: generatePublicId(), role: 'USER' },
      params,
      body: {},
      query: {},
      headers: {},
      id: 'req-id',
    } as unknown as FastifyRequest;
  }

  function mockReply(): FastifyReply {
    return {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
  }

  it('acceptMemberInvitation rejects a malformed invitationId (sec-new-T2)', async () => {
    await expect(
      controller.acceptMemberInvitation(
        mockUserRequest({ invitationId: 'not-a-public-id!!' }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.accept).not.toHaveBeenCalled();
  });

  it('acceptMemberInvitation accepts a valid invitationId and calls service.accept (sec-new-T2)', async () => {
    await controller.acceptMemberInvitation(
      mockUserRequest({ invitationId: invitationPublicId }),
      mockReply(),
    );
    expect(service.accept).toHaveBeenCalledWith(
      invitationPublicId,
      expect.anything(),
      expect.any(String),
    );
  });

  it('revokeMemberInvitation rejects a malformed invitationId (sec-new-T2)', async () => {
    await expect(
      controller.revokeMemberInvitation(
        mockUserRequest({ id: organizationPublicId, invitationId: '../../etc/passwd' }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.revoke).not.toHaveBeenCalled();
  });

  it('revokeMemberInvitation accepts a valid invitationId and calls service.revoke (sec-new-T2)', async () => {
    await controller.revokeMemberInvitation(
      mockUserRequest({ id: organizationPublicId, invitationId: invitationPublicId }),
      mockReply(),
    );
    expect(service.revoke).toHaveBeenCalledWith(organizationPublicId, invitationPublicId);
  });

  it('resendInvitation rejects a malformed invitationId (sec-new-T2)', async () => {
    await expect(
      controller.resendInvitation(
        mockUserRequest({ id: organizationPublicId, invitationId: 'inv_bad id' }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.resend).not.toHaveBeenCalled();
  });

  it('resendInvitation accepts a valid invitationId and calls service.resend (sec-new-T2)', async () => {
    await controller.resendInvitation(
      mockUserRequest({ id: organizationPublicId, invitationId: invitationPublicId }),
      mockReply(),
    );
    expect(service.resend).toHaveBeenCalledWith(
      organizationPublicId,
      invitationPublicId,
      expect.anything(),
    );
  });

  it('declineInvitation rejects a malformed invitationId (sec-new-T2)', async () => {
    await expect(
      controller.declineInvitation(mockUserRequest({ invitationId: '' }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.decline).not.toHaveBeenCalled();
  });

  it('declineInvitation accepts a valid invitationId and calls service.decline (sec-new-T2)', async () => {
    await controller.declineInvitation(
      mockUserRequest({ invitationId: invitationPublicId }),
      mockReply(),
    );
    expect(service.decline).toHaveBeenCalledWith(invitationPublicId, expect.any(String));
  });
});
