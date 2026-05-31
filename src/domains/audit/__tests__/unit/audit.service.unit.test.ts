import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '@/domains/audit/audit.service.js';
import type { AuditRepository } from '@/domains/audit/audit.repository.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureMessage: vi.fn(),
}));

/**
 * AuditService.record() wraps repository calls in `withUserDatabaseContext`, which opens
 * a real `database.transaction()` and would hang the unit test (repositories are mocked).
 * Run the inner callback directly so we still exercise service intent without Postgres.
 */
vi.mock('@/infrastructure/database/contexts/user-database.context.js', () => ({
  withUserDatabaseContext: vi.fn((_userPublicId: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
}));

const globalAdminContextMock = vi.hoisted(() =>
  vi.fn((callback: () => Promise<unknown>) => callback()),
);

/**
 * `listForAdmin` wraps the read in `withGlobalAdminDatabaseContext`, which opens a real
 * transaction with `SET LOCAL app.global_admin = true`. Run the callback directly so the
 * unit test exercises service intent (and asserts the wrapper is used) without Postgres.
 */
vi.mock('@/infrastructure/database/contexts/global-admin-database.context.js', () => ({
  withGlobalAdminDatabaseContext: globalAdminContextMock,
}));

describe('AuditService', () => {
  const repository = {
    insert: vi.fn().mockResolvedValue(undefined),
    findWithFilters: vi.fn().mockResolvedValue({
      items: [{ action: 'user.login' }],
      total: 1,
      hasMore: false,
      nextCursor: null,
    }),
  } as unknown as AuditRepository;

  const organizationService = {
    findOrganizationByPublicId: vi.fn().mockResolvedValue({ id: 10, public_id: 'org_public' }),
  } as unknown as OrganizationService;

  const userService = {
    findUserRecordByPublicId: vi.fn().mockResolvedValue({ id: 5, public_id: 'user_public' }),
  } as unknown as UserService;

  const service = new AuditService(repository, organizationService, userService);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue({
      id: 5,
      public_id: 'user_public',
    } as never);
  });

  it('record inserts audit row when actor exists', async () => {
    await service.record({
      actorUserPublicId: 'user_public',
      action: 'user.login',
      resource_type: 'user',
    });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_user_id: 5, action: 'user.login' }),
    );
  });

  it('record skips insert when actor is unknown', async () => {
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
    await service.record({
      actorUserPublicId: 'missing',
      action: 'user.login',
      resource_type: 'user',
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('list resolves organization and actor filters', async () => {
    const organizationPublicId = generatePublicId();
    const actorPublicId = generatePublicId();
    const result = await service.list({
      limit: 20,
      organization_id: organizationPublicId,
      actor_user_id: actorPublicId,
      resource_type: 'user',
      action: 'user.login',
    });
    expect(repository.findWithFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 10,
        actor_user_id: 5,
        resource_type: 'user',
        action: 'user.login',
        limit: 20,
      }),
    );
    expect(result.total).toBe(1);
    expect(result.next_cursor).toBeNull();
  });

  it('list returns empty page when organization public id is unknown without total by default', async () => {
    vi.mocked(organizationService.findOrganizationByPublicId).mockResolvedValue(null);
    const result = await service.list({ limit: 20, organization_id: generatePublicId() });
    expect(repository.findWithFilters).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      total: null,
      limit: 20,
      has_more: false,
      next_cursor: null,
    });
  });

  it('list returns empty page with total zero when organization public id is unknown and include_total=true', async () => {
    vi.mocked(organizationService.findOrganizationByPublicId).mockResolvedValue(null);
    const result = await service.list({
      limit: 20,
      organization_id: generatePublicId(),
      include_total: 'true',
    });
    expect(repository.findWithFilters).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      total: 0,
      limit: 20,
      has_more: false,
      next_cursor: null,
    });
  });

  it('list returns empty page when actor public id is unknown without total by default', async () => {
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
    const result = await service.list({ limit: 20, actor_user_id: generatePublicId() });
    expect(repository.findWithFilters).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      total: null,
      limit: 20,
      has_more: false,
      next_cursor: null,
    });
  });

  it('list returns empty page with total zero when actor public id is unknown and include_total=true', async () => {
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
    const result = await service.list({
      limit: 20,
      actor_user_id: generatePublicId(),
      include_total: 'true',
    });
    expect(repository.findWithFilters).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      total: 0,
      limit: 20,
      has_more: false,
      next_cursor: null,
    });
  });

  it('list returns empty page when no rows', async () => {
    vi.mocked(repository.findWithFilters).mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
      nextCursor: null,
    });
    const result = await service.list({ limit: 20 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('listForAdmin runs the listing inside the global-admin RLS context', async () => {
    vi.mocked(repository.findWithFilters).mockResolvedValue({
      items: [{ action: 'user.login' }],
      total: 1,
      hasMore: false,
      nextCursor: null,
    } as never);
    const result = await service.listForAdmin({ limit: 20 });
    expect(globalAdminContextMock).toHaveBeenCalledTimes(1);
    expect(repository.findWithFilters).toHaveBeenCalled();
    expect(result.total).toBe(1);
  });

  it('list skips the total when include_total=false and derives has_more', async () => {
    vi.mocked(repository.findWithFilters).mockResolvedValue({
      items: [{ action: 'user.login' }],
      total: null,
      hasMore: true,
      nextCursor: 'cursor_2',
    } as never);
    const result = await service.list({ limit: 20, include_total: 'false' });
    expect(repository.findWithFilters).toHaveBeenCalledWith(
      expect.objectContaining({ include_total: false }),
    );
    expect(result.total).toBeNull();
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe('cursor_2');
  });
});
