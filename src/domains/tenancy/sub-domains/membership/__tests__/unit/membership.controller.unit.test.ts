import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '@/shared/errors/index.js';
import { createMembershipController } from '@/domains/tenancy/sub-domains/membership/membership.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { kind: 'user' as const, userId: generatePublicId(), role: 'USER' },
    params: {},
    body: {},
    query: { limit: 20 },
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

describe('createMembershipController', () => {
  const organizationPublicId = generatePublicId();
  const membershipPublicId = generatePublicId();
  const membership = { id: membershipPublicId };
  const service = {
    list: vi.fn().mockResolvedValue({
      items: [membership],
      limit: 20,
      total: null,
      has_more: true,
      next_cursor: 'membership_cursor_2',
    }),
    getByPublicId: vi.fn().mockResolvedValue(membership),
    create: vi.fn().mockResolvedValue(membership),
    update: vi.fn().mockResolvedValue(membership),
    delete: vi.fn().mockResolvedValue(undefined),
    getPermissions: vi.fn().mockResolvedValue({ permissions: ['organization:read'] }),
    leaveOrganization: vi.fn().mockResolvedValue(undefined),
    transferOwnership: vi.fn().mockResolvedValue(membership),
  };

  const controller = createMembershipController(service as never);

  it('listMemberships returns paginated memberships', async () => {
    const response = await controller.listMemberships(
      mockRequest({ params: { id: organizationPublicId } }),
      {} as FastifyReply,
    );
    expect(service.list).toHaveBeenCalled();
    expect(response).toMatchObject({
      meta: {
        pagination: expect.objectContaining({ has_more: true, next: 'membership_cursor_2' }),
      },
    });
  });

  it('getMembership returns membership', async () => {
    await controller.getMembership(
      mockRequest({ params: { id: organizationPublicId, membershipId: membershipPublicId } }),
      {} as FastifyReply,
    );
    expect(service.getByPublicId).toHaveBeenCalled();
  });

  it('createMembership returns 201', async () => {
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await controller.createMembership(
      mockRequest({
        params: { id: organizationPublicId },
        body: { user_id: generatePublicId(), role_id: generatePublicId() },
      }),
      reply as unknown as FastifyReply,
    );
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it('updateMembership and deleteMembership delegate to service', async () => {
    await controller.updateMembership(
      mockRequest({
        params: { id: organizationPublicId, membershipId: membershipPublicId },
        body: { status: 'ACTIVE' },
      }),
      {} as FastifyReply,
    );
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await controller.deleteMembership(
      mockRequest({ params: { id: organizationPublicId, membershipId: membershipPublicId } }),
      reply as unknown as FastifyReply,
    );
    expect(service.update).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it('getMembershipPermissions leave and transferOwnership delegate to service', async () => {
    await controller.getMembershipPermissions(
      mockRequest({ params: { id: organizationPublicId, membershipId: membershipPublicId } }),
      {} as FastifyReply,
    );
    const leaveReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await controller.leaveOrganization(
      mockRequest({ params: { id: organizationPublicId } }),
      leaveReply as unknown as FastifyReply,
    );
    await controller.transferOwnership(
      mockRequest({
        params: { id: organizationPublicId },
        body: { new_owner_user_id: generatePublicId() },
      }),
      {} as FastifyReply,
    );
    expect(service.getPermissions).toHaveBeenCalled();
    expect(service.leaveOrganization).toHaveBeenCalled();
    expect(service.transferOwnership).toHaveBeenCalled();
  });

  it('listMemberships returns has_more false when all items fit page', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [{ id: 'mem_public' }],
      limit: 20,
      total: null,
      has_more: false,
      next_cursor: null,
    } as never);
    const response = await controller.listMemberships(
      mockRequest({ params: { id: organizationPublicId } }),
      mockReply(),
    );
    expect(response).toMatchObject({
      meta: { pagination: expect.objectContaining({ has_more: false }) },
    });
  });

  it('rejects invalid organization id on validated handlers', async () => {
    const invalidId = 'not-a-public-id';
    await expect(
      controller.listMemberships(mockRequest({ params: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.listMemberships(mockRequest({ params: { id: invalidId } }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.createMembership(mockRequest({ params: {}, body: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.createMembership(mockRequest({ params: { id: '' }, body: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.leaveOrganization(mockRequest({ params: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.leaveOrganization(mockRequest({ params: { id: invalidId } }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.transferOwnership(mockRequest({ params: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.transferOwnership(mockRequest({ params: { id: 'bad' }, body: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getMembershipPermissions delegates to service with valid params', async () => {
    await controller.getMembershipPermissions(
      mockRequest({ params: { id: organizationPublicId, membershipId: membershipPublicId } }),
      mockReply(),
    );
    expect(service.getPermissions).toHaveBeenCalledWith(organizationPublicId, membershipPublicId);
  });

  it('createMembership returns 201 with valid organization id', async () => {
    const reply = mockReply();
    await controller.createMembership(
      mockRequest({
        params: { id: organizationPublicId },
        body: { user_id: generatePublicId(), role_id: generatePublicId(), status: 'ACTIVE' },
      }),
      reply,
    );
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(service.create).toHaveBeenCalled();
  });

  it('listMemberships uses empty id when params omit id', async () => {
    vi.mocked(service.list).mockClear();
    await expect(
      controller.listMemberships(mockRequest({ params: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('sec-re-18: updateMembership and deleteMembership reject when the organization id is missing instead of passing a sentinel through', async () => {
    // Prior behaviour: missing organization id collapsed to undefined / '' and was
    // forwarded to the service (which would then fail elsewhere with unbounded
    // cardinality on the observability path). sec-re-18 binds at the boundary
    // with validatePublicIdParam so the request is rejected with ValidationError
    // before the service is reached.
    vi.mocked(service.update).mockClear();
    vi.mocked(service.delete).mockClear();
    await expect(
      controller.updateMembership(
        mockRequest({ params: { membershipId: membershipPublicId }, body: { status: 'ACTIVE' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.update).not.toHaveBeenCalled();
    await expect(
      controller.deleteMembership(
        mockRequest({ params: { membershipId: membershipPublicId } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('sec-re-18: every membership handler that takes path params rejects undefined / invalid ids with ValidationError', async () => {
    vi.mocked(service.getByPublicId).mockClear();
    vi.mocked(service.update).mockClear();
    vi.mocked(service.delete).mockClear();
    vi.mocked(service.getPermissions).mockClear();

    await expect(
      controller.getMembership(mockRequest({ params: undefined }), {} as FastifyReply),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.getByPublicId).not.toHaveBeenCalled();

    await expect(
      controller.getMembershipPermissions(mockRequest({ params: undefined }), {} as FastifyReply),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.getPermissions).not.toHaveBeenCalled();

    await expect(
      controller.updateMembership(
        mockRequest({ params: undefined, body: { status: 'ACTIVE' } }),
        {} as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.update).not.toHaveBeenCalled();

    const deleteReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await expect(
      controller.deleteMembership(
        mockRequest({ params: undefined }),
        deleteReply as unknown as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('sec-re-18: handlers reject an invalid membershipId at the boundary', async () => {
    // membershipId was previously a raw passthrough — an attacker-supplied
    // string would flow into the service and downstream observability.
    vi.mocked(service.getByPublicId).mockClear();
    vi.mocked(service.getPermissions).mockClear();
    await expect(
      controller.getMembership(
        mockRequest({ params: { id: organizationPublicId, membershipId: 'not-a-public-id' } }),
        {} as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.getByPublicId).not.toHaveBeenCalled();
    await expect(
      controller.getMembershipPermissions(
        mockRequest({ params: { id: organizationPublicId, membershipId: 'not-a-public-id' } }),
        {} as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(service.getPermissions).not.toHaveBeenCalled();
  });
});
