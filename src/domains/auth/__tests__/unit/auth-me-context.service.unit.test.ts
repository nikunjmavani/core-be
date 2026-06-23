import { describe, expect, it, vi } from 'vitest';
import { AuthMeContextService } from '@/domains/auth/auth-me-context.service.js';

describe('AuthMeContextService.getContext', () => {
  it('aggregates the user, active organization, resolved permissions, and org list', async () => {
    const activeOrganization = { id: 'org_active', type: 'TEAM' };
    const userService = { getMe: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'a@b.com' }) };
    const organizationService = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [activeOrganization, { id: 'org_2', type: 'PERSONAL' }] }),
      getByPublicId: vi.fn().mockResolvedValue(activeOrganization),
    };
    const authorizationService = {
      resolveUserOrganizationPermissions: vi.fn().mockResolvedValue(['organization:read']),
    };
    const service = new AuthMeContextService(
      userService as never,
      organizationService as never,
      authorizationService as never,
    );

    const data = await service.getContext({
      userPublicId: 'usr_1',
      activeOrganizationPublicId: 'org_active',
      globalRole: undefined,
    });

    expect(userService.getMe).toHaveBeenCalledWith('usr_1');
    expect(organizationService.getByPublicId).toHaveBeenCalledWith(
      'org_active',
      'usr_1',
      undefined,
    );
    expect(authorizationService.resolveUserOrganizationPermissions).toHaveBeenCalledWith(
      'usr_1',
      'org_active',
    );
    expect(data.activeOrganization).toBe(activeOrganization);
    expect(data.activeOrganizationPublicId).toBe('org_active');
    expect(data.myPermissions).toEqual(['organization:read']);
    expect(data.organizations).toHaveLength(2);
  });

  it('returns a null active organization and no permissions when no active org is in scope', async () => {
    const userService = { getMe: vi.fn().mockResolvedValue({ id: 'usr_1' }) };
    const organizationService = {
      list: vi.fn().mockResolvedValue({ items: [] }),
      getByPublicId: vi.fn(),
    };
    const authorizationService = { resolveUserOrganizationPermissions: vi.fn() };
    const service = new AuthMeContextService(
      userService as never,
      organizationService as never,
      authorizationService as never,
    );

    const data = await service.getContext({
      userPublicId: 'usr_1',
      activeOrganizationPublicId: undefined,
      globalRole: undefined,
    });

    expect(data.activeOrganization).toBeNull();
    expect(data.activeOrganizationPublicId).toBeNull();
    expect(data.myPermissions).toEqual([]);
    expect(organizationService.getByPublicId).not.toHaveBeenCalled();
    expect(authorizationService.resolveUserOrganizationPermissions).not.toHaveBeenCalled();
  });
});

describe('AuthMeContextService.getActiveOrganizationContext', () => {
  it('resolves only the active-org slice (org + permissions) without the user / org-list reads', async () => {
    const activeOrganization = { id: 'org_active', type: 'TEAM' };
    const userService = { getMe: vi.fn() };
    const organizationService = {
      list: vi.fn(),
      getByPublicId: vi.fn().mockResolvedValue(activeOrganization),
    };
    const authorizationService = {
      resolveUserOrganizationPermissions: vi
        .fn()
        .mockResolvedValue(['organization:read', 'membership:manage']),
    };
    const service = new AuthMeContextService(
      userService as never,
      organizationService as never,
      authorizationService as never,
    );

    const data = await service.getActiveOrganizationContext({
      userPublicId: 'usr_1',
      organizationPublicId: 'org_active',
      globalRole: undefined,
    });

    expect(data).toEqual({
      active_organization: activeOrganization,
      my_permissions: ['organization:read', 'membership:manage'],
      global_role: null,
    });
    // The lean delta must NOT pull the heavier user / organizations[] payload (those are stable
    // across a switch and reused from the client's initial /me/context).
    expect(userService.getMe).not.toHaveBeenCalled();
    expect(organizationService.list).not.toHaveBeenCalled();
  });
});
