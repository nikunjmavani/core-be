import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createOrganizationNotificationPolicyController } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import type { OrganizationNotificationPolicyService } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.service.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { kind: 'user', userId: generatePublicId(), role: 'user' },
    params: {},
    body: {},
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

const organizationPublicId = generatePublicId();
const policyRow = {
  id: 1,
  organization_id: organizationPublicId,
  notification_type: 'invite',
  channel: 'email',
  default_enabled: true,
  is_mandatory: false,
  muted_until: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('createOrganizationNotificationPolicyController', () => {
  const service = {
    list: vi.fn().mockResolvedValue([policyRow]),
    getById: vi.fn().mockResolvedValue(policyRow),
    create: vi.fn().mockResolvedValue(policyRow),
    update: vi.fn().mockResolvedValue(policyRow),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationNotificationPolicyService;

  const controller = createOrganizationNotificationPolicyController(service);

  it('listPolicies delegates to service and returns policies', async () => {
    const response = await controller.listPolicies(
      mockRequest({ params: { id: organizationPublicId } }),
      mockReply(),
    );
    expect(service.list).toHaveBeenCalledWith(organizationPublicId);
    expect(response).toMatchObject({ data: [policyRow] });
  });

  it('listPolicies propagates NotFoundError when org is missing', async () => {
    vi.mocked(service.list).mockRejectedValueOnce(new NotFoundError('Organization'));
    await expect(
      controller.listPolicies(mockRequest({ params: { id: organizationPublicId } }), mockReply()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getPolicy delegates to service with policy id', async () => {
    const response = await controller.getPolicy(
      mockRequest({ params: { id: organizationPublicId, policyId: '1' } }),
      mockReply(),
    );
    expect(service.getById).toHaveBeenCalledWith(organizationPublicId, 1);
    expect(response).toMatchObject({ data: policyRow });
  });

  it('getPolicy propagates NotFoundError when policy is missing', async () => {
    vi.mocked(service.getById).mockRejectedValueOnce(
      new NotFoundError('Organization notification policy'),
    );
    await expect(
      controller.getPolicy(
        mockRequest({ params: { id: organizationPublicId, policyId: '1' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('createPolicy sets 201 status and delegates to service', async () => {
    const body = {
      notification_type: 'invite',
      channel: 'email',
      default_enabled: true,
      is_mandatory: false,
    };
    const userId = generatePublicId();
    const reply = mockReply();
    const response = await controller.createPolicy(
      mockRequest({
        params: { id: organizationPublicId },
        body,
        auth: { kind: 'user', userId, role: 'user' } as never,
      }),
      reply,
    );
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(service.create).toHaveBeenCalledWith(organizationPublicId, body, userId);
    expect(response).toMatchObject({ data: policyRow });
  });

  it('createPolicy throws UnauthorizedError when auth is missing', async () => {
    await expect(
      controller.createPolicy(
        mockRequest({ params: { id: organizationPublicId }, auth: undefined as never }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('updatePolicy delegates to service with policy id and user', async () => {
    const body = { default_enabled: false };
    const userId = generatePublicId();
    const response = await controller.updatePolicy(
      mockRequest({
        params: { id: organizationPublicId, policyId: '1' },
        body,
        auth: { kind: 'user', userId, role: 'user' } as never,
      }),
      mockReply(),
    );
    expect(service.update).toHaveBeenCalledWith(organizationPublicId, 1, body, userId);
    expect(response).toMatchObject({ data: policyRow });
  });

  it('updatePolicy throws UnauthorizedError when auth is missing', async () => {
    await expect(
      controller.updatePolicy(
        mockRequest({
          params: { id: organizationPublicId, policyId: '1' },
          auth: undefined as never,
        }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('updatePolicy propagates NotFoundError when policy is missing', async () => {
    vi.mocked(service.update).mockRejectedValueOnce(
      new NotFoundError('Organization notification policy'),
    );
    await expect(
      controller.updatePolicy(
        mockRequest({ params: { id: organizationPublicId, policyId: '1' }, body: {} }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletePolicy calls service delete and sends 204', async () => {
    const reply = mockReply();
    await controller.deletePolicy(
      mockRequest({ params: { id: organizationPublicId, policyId: '1' } }),
      reply,
    );
    expect(service.delete).toHaveBeenCalledWith(organizationPublicId, 1);
    expect(reply.code).toHaveBeenCalledWith(204);
    expect(reply.send).toHaveBeenCalled();
  });

  it('deletePolicy throws UnauthorizedError when auth is missing', async () => {
    await expect(
      controller.deletePolicy(
        mockRequest({
          params: { id: organizationPublicId, policyId: '1' },
          auth: undefined as never,
        }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('deletePolicy propagates NotFoundError when policy is missing', async () => {
    vi.mocked(service.delete).mockRejectedValueOnce(
      new NotFoundError('Organization notification policy'),
    );
    await expect(
      controller.deletePolicy(
        mockRequest({ params: { id: organizationPublicId, policyId: '1' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
