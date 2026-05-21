import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '@/shared/errors/index.js';
import { GLOBAL_ROLES } from '@/shared/constants/index.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

vi.mock('@/domains/tenancy/sub-domains/permission/authorization.service.js', () => ({
  resolveUserOrganizationPermissions: vi.fn(),
}));

import { resolveUserOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import {
  requireOrganizationPermission,
  requireRole,
} from '@/shared/utils/auth/authorization.util.js';

const mockedResolvePermissions = vi.mocked(resolveUserOrganizationPermissions);

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { userId: 'user-1', role: GLOBAL_ROLES.USER },
    params: { organizationId: 'org-public' },
    ...overrides,
  } as FastifyRequest;
}

const mockReply = {} as FastifyReply;

describe('authorization.util', () => {
  beforeEach(() => {
    mockedResolvePermissions.mockReset();
  });

  describe('requireRole', () => {
    it('allows user with matching global role', async () => {
      const handler = requireRole(GLOBAL_ROLES.USER);
      await expect(
        handler(mockRequest({ auth: { userId: 'user-1', role: GLOBAL_ROLES.USER } }), mockReply),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when role is not allowed', async () => {
      const handler = requireRole(GLOBAL_ROLES.SUPER_ADMIN);
      await expect(
        handler(mockRequest({ auth: { userId: 'user-1', role: GLOBAL_ROLES.USER } }), mockReply),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const handler = requireRole(GLOBAL_ROLES.USER);
      await expect(handler(mockRequest({ auth: null }), mockReply)).rejects.toThrow(
        UnauthorizedError,
      );
    });
  });

  describe('requireOrganizationPermission', () => {
    it('allows when user has required permission', async () => {
      mockedResolvePermissions.mockResolvedValue(['membership:read', 'membership:manage']);
      const handler = requireOrganizationPermission('membership:manage');
      await expect(handler(mockRequest(), mockReply)).resolves.toBeUndefined();
      expect(mockedResolvePermissions).toHaveBeenCalledWith('user-1', 'org-public');
    });

    it('throws ForbiddenError when permission is missing', async () => {
      mockedResolvePermissions.mockResolvedValue(['membership:read']);
      const handler = requireOrganizationPermission('membership:manage');
      await expect(handler(mockRequest(), mockReply)).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when organization id param is missing', async () => {
      const handler = requireOrganizationPermission('membership:read');
      await expect(handler(mockRequest({ params: {} }), mockReply)).rejects.toThrow(ForbiddenError);
    });

    it('falls back to id param when organizationId is absent', async () => {
      mockedResolvePermissions.mockResolvedValue(['membership:read']);
      const handler = requireOrganizationPermission('membership:read', 'organizationId');
      await expect(
        handler(mockRequest({ params: { id: 'org-by-id' } as Record<string, string> }), mockReply),
      ).resolves.toBeUndefined();
      expect(mockedResolvePermissions).toHaveBeenCalledWith('user-1', 'org-by-id');
    });

    it('throws UnauthorizedError when not authenticated', async () => {
      const handler = requireOrganizationPermission('membership:read');
      await expect(handler(mockRequest({ auth: null }), mockReply)).rejects.toThrow(
        UnauthorizedError,
      );
    });
  });
});
