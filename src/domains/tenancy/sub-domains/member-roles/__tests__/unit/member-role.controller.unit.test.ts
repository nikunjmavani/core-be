import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '@/shared/errors/index.js';
import { createMemberRoleController } from '@/domains/tenancy/sub-domains/member-roles/member-role.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { MemberRoleService } from '@/domains/tenancy/sub-domains/member-roles/member-role.service.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { kind: 'user' as const, userId: generatePublicId(), role: 'USER' },
    params: {},
    body: {},
    query: {},
    headers: {},
    id: 'request-id',
    server: {
      auditDomain: { auditService: { record: vi.fn().mockResolvedValue(undefined) } },
    },
    ...overrides,
  } as FastifyRequest;
}

function mockReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('createMemberRoleController', () => {
  const organizationPublicId = generatePublicId();
  const rolePublicId = generatePublicId();
  const role = { public_id: rolePublicId, name: 'Admin' };

  const service = {
    list: vi.fn().mockResolvedValue({
      items: [role],
      limit: 25,
      total: null,
      has_more: false,
      next_cursor: null,
    }),
    getByPublicId: vi.fn().mockResolvedValue(role),
    create: vi.fn().mockResolvedValue(role),
    update: vi.fn().mockResolvedValue(role),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemberRoleService;

  const controller = createMemberRoleController(service);

  it('listRoles returns paginated roles', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [role],
      limit: 25,
      total: null,
      has_more: true,
      next_cursor: 'role_cursor_2',
    } as never);
    const response = await controller.listRoles(
      mockRequest({ params: { id: organizationPublicId } }),
      mockReply(),
    );
    expect(service.list).toHaveBeenCalledWith(organizationPublicId, { limit: 25 });
    expect(response).toMatchObject({
      data: [role],
      meta: { pagination: expect.objectContaining({ has_more: true, next: 'role_cursor_2' }) },
    });
  });

  it('getRole delegates to service', async () => {
    await controller.getRole(
      mockRequest({ params: { id: organizationPublicId, roleId: rolePublicId } }),
      mockReply(),
    );
    expect(service.getByPublicId).toHaveBeenCalledWith(organizationPublicId, rolePublicId);
  });

  it('createRole returns 201', async () => {
    const reply = mockReply();
    await controller.createRole(
      mockRequest({
        params: { id: organizationPublicId },
        body: { name: 'Editor', permission_codes: ['organization:read'] },
      }),
      reply,
    );
    expect(service.create).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it('updateRole delegates to service', async () => {
    await controller.updateRole(
      mockRequest({
        params: { id: organizationPublicId, roleId: rolePublicId },
        body: { name: 'Updated' },
      }),
      mockReply(),
    );
    expect(service.update).toHaveBeenCalled();
  });

  it('deleteRole returns 204', async () => {
    const reply = mockReply();
    await controller.deleteRole(
      mockRequest({ params: { id: organizationPublicId, roleId: rolePublicId } }),
      reply,
    );
    expect(service.delete).toHaveBeenCalledWith(organizationPublicId, rolePublicId);
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it('listRoles returns has_more false when all items fit page', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [role],
      limit: 25,
      total: null,
      has_more: false,
      next_cursor: null,
    } as never);
    const response = await controller.listRoles(
      mockRequest({ params: { id: organizationPublicId } }),
      mockReply(),
    );
    expect(response).toMatchObject({
      meta: { pagination: expect.objectContaining({ has_more: false }) },
    });
  });

  it('createRole rejects missing organization id when params omit id', async () => {
    await expect(
      controller.createRole(mockRequest({ params: {}, body: { name: 'X' } }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects invalid organization id on listRoles and createRole', async () => {
    await expect(
      controller.listRoles(mockRequest({ params: {} }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.listRoles(mockRequest({ params: { id: 'invalid' } }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.listRoles(mockRequest({ params: { id: '' } }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.createRole(
        mockRequest({ params: { id: 'not-valid' }, body: { name: 'X' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      controller.createRole(mockRequest({ params: { id: '' }, body: { name: 'X' } }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getRole with valid organization id uses params without fallback', async () => {
    vi.mocked(service.getByPublicId).mockClear();
    await controller.getRole(
      mockRequest({ params: { id: organizationPublicId, roleId: rolePublicId } }),
      mockReply(),
    );
    expect(service.getByPublicId).toHaveBeenCalledWith(organizationPublicId, rolePublicId);
  });

  // sec-new-T3: getRole, updateRole, deleteRole now validate both id and roleId.
  it('getRole rejects malformed roleId (sec-new-T3)', async () => {
    await expect(
      controller.getRole(
        mockRequest({ params: { id: organizationPublicId, roleId: 'not_a_valid_id!!' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getRole rejects malformed organizationId (sec-new-T3)', async () => {
    await expect(
      controller.getRole(
        mockRequest({ params: { id: '../../etc', roleId: rolePublicId } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('getRole rejects empty params (sec-new-T3)', async () => {
    await expect(
      controller.getRole(mockRequest({ params: undefined }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateRole rejects malformed roleId (sec-new-T3)', async () => {
    await expect(
      controller.updateRole(
        mockRequest({ params: { id: organizationPublicId, roleId: '' }, body: { name: 'X' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateRole rejects malformed organizationId (sec-new-T3)', async () => {
    await expect(
      controller.updateRole(
        mockRequest({ params: { id: 'bad id', roleId: rolePublicId }, body: { name: 'X' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('deleteRole rejects malformed roleId (sec-new-T3)', async () => {
    await expect(
      controller.deleteRole(
        mockRequest({ params: { id: organizationPublicId, roleId: '' } }),
        mockReply(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('deleteRole rejects empty params (sec-new-T3)', async () => {
    await expect(
      controller.deleteRole(mockRequest({ params: undefined }), mockReply()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
