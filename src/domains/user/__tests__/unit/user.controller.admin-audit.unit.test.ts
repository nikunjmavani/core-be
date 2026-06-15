import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createUserController } from '@/domains/user/user.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

/**
 * Regression for sec-U9 (Medium): admin user-management actions
 * (PATCH /:user_id, POST /:user_id/suspend, POST /:user_id/unsuspend,
 * DELETE /:user_id) and the self-delete (DELETE /me) used to write no audit
 * row. A rogue admin could wipe accounts and leave no platform-visible
 * record; a deleted user complaining "someone deleted my account" was
 * unanswerable.
 *
 * Every admin action now writes a `user.admin.*` audit row. Suspend / delete
 * paths use severity `WARNING` so they surface in severity-filtered queries.
 * The self-delete path writes `user.self.delete` so support can see the user
 * initiated their own offboarding.
 */
describe('createUserController — admin user-management audit (sec-U9)', () => {
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const adminPublicId = generatePublicId('user');
  const targetUserPublicId = generatePublicId('user');

  function mockAdminRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
    return {
      auth: { kind: 'user' as const, userId: adminPublicId, role: 'super_admin' },
      params: { user_id: targetUserPublicId },
      body: {},
      query: {},
      headers: {},
      id: 'request-id',
      ip: '127.0.0.1',
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      server: {
        auditDomain: { auditService: { record: auditRecord } },
        tenancyDomain: { organizationService: { findOrganizationByPublicId: vi.fn() } },
      },
      ...overrides,
    } as FastifyRequest;
  }

  const userService = {
    getMe: vi.fn(),
    updateMe: vi.fn(),
    deleteMe: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn(),
    getUser: vi.fn(),
    adminUpdateUser: vi.fn().mockResolvedValue({ id: targetUserPublicId }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    suspendUser: vi.fn().mockResolvedValue({ id: targetUserPublicId }),
    unsuspendUser: vi.fn().mockResolvedValue({ id: targetUserPublicId }),
    uploadAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
  };
  const userSettingsService = { get: vi.fn(), update: vi.fn() };
  const userNotificationPreferencesService = { get: vi.fn(), put: vi.fn() };

  const controller = createUserController({
    userService: userService as never,
    userSettingsService: userSettingsService as never,
    userNotificationPreferencesService: userNotificationPreferencesService as never,
  });

  beforeEach(() => {
    auditRecord.mockClear();
  });

  it('updateUser writes user.admin.update audit (default INFO severity)', async () => {
    await controller.updateUser(
      mockAdminRequest({ body: { first_name: 'Bob' } }),
      {} as FastifyReply,
    );
    expect(auditRecord).toHaveBeenCalledTimes(1);
    const call = auditRecord.mock.calls[0]?.[0];
    // No `severity` set → audit.service defaults to INFO; non-suspend updates
    // do not need WARNING surface treatment.
    expect(call).toMatchObject({
      action: 'user.admin.update',
      resource_type: 'user',
      actorUserPublicId: adminPublicId,
    });
    expect(call?.severity).toBeUndefined();
  });

  it('suspendUser writes user.admin.suspend audit at WARNING severity', async () => {
    await controller.suspendUser(mockAdminRequest(), {} as FastifyReply);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    const call = auditRecord.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: 'user.admin.suspend',
      resource_type: 'user',
      actorUserPublicId: adminPublicId,
      severity: 'WARNING',
    });
  });

  it('unsuspendUser writes user.admin.unsuspend audit at WARNING severity', async () => {
    await controller.unsuspendUser(mockAdminRequest(), {} as FastifyReply);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    const call = auditRecord.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: 'user.admin.unsuspend',
      resource_type: 'user',
      actorUserPublicId: adminPublicId,
      severity: 'WARNING',
    });
  });

  it('deleteUser writes user.admin.delete audit at WARNING severity', async () => {
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await controller.deleteUser(mockAdminRequest(), reply as unknown as FastifyReply);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    const call = auditRecord.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: 'user.admin.delete',
      resource_type: 'user',
      actorUserPublicId: adminPublicId,
      severity: 'WARNING',
    });
  });

  it('deleteMe writes user.self.delete audit at WARNING severity', async () => {
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    const selfPublicId = generatePublicId('user');
    const selfRequest = mockAdminRequest({
      auth: { kind: 'user' as const, userId: selfPublicId, role: 'user' },
      params: {},
    });
    await controller.deleteMe(selfRequest, reply as unknown as FastifyReply);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    const call = auditRecord.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: 'user.self.delete',
      resource_type: 'user',
      actorUserPublicId: selfPublicId,
      severity: 'WARNING',
    });
  });
});
