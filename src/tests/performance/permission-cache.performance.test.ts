import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  createMembership,
  createRoleWithPermissions,
  seedPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { AuthorizationService } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import { PermissionRepository } from '@/domains/tenancy/sub-domains/permission/permission.repository.js';

/**
 * The suite overview has always CLAIMED "cache hit-ratio for the permission cache under
 * repeated reads" — this file makes the claim true. Permission resolution runs on every
 * organization-scoped request (`requireOrganizationPermission` preHandler), so its cost
 * model is the platform's hottest path: a 5-table join on miss, a Redis read on hit.
 *
 * Measured exactly (billing-list's counting-port pattern — no timing, no flake): a spy on
 * `PermissionRepository.findPermissionCodesForUserInOrganization` counts the joins the
 * cache lets through. The regression this catches: a refactor that drops the
 * `getCachedPermissions` fast path (or breaks the cache key) keeps every functional
 * assertion green while silently running the join once per request.
 *
 * Cache keys are per (user, organization) public id and every test run generates fresh
 * ids, so runs never collide with each other's Redis entries.
 */
const PERMISSION_CODES = ['organization:read', 'membership:read'];

describe('Performance: permission cache hit ratio', () => {
  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(PERMISSION_CODES);
  });

  /** Org + member whose role carries {@link PERMISSION_CODES}, plus a counting service. */
  async function createResolutionContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: PERMISSION_CODES,
    });
    await createMembership({ userId: user.id, organizationId: organization.id, roleId: role.id });

    const repository = new PermissionRepository();
    const joinSpy = vi.spyOn(repository, 'findPermissionCodesForUserInOrganization');
    const service = new AuthorizationService(repository);
    return { user, organization, service, joinSpy };
  }

  it('runs the 5-table join once for repeated resolutions of the same (user, organization)', async () => {
    const { user, organization, service, joinSpy } = await createResolutionContext();

    const first = await service.resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );
    const second = await service.resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );
    const third = await service.resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );

    // The cached reads must return the SAME set (order is not part of the contract) —
    // a budget met by returning [] from a broken cache entry would be a regression.
    const sorted = (codes: string[]) => [...codes].sort();
    expect(sorted(first)).toEqual(sorted(PERMISSION_CODES));
    expect(sorted(second)).toEqual(sorted(first));
    expect(sorted(third)).toEqual(sorted(first));
    // THE budget: one database join for three resolutions (miss, hit, hit).
    expect(joinSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps cache entries per (user, organization) — a second member does not share the first entry', async () => {
    const { user, organization, service, joinSpy } = await createResolutionContext();
    const otherMember = await createTestUser({ email: 'other-member@permission-cache-perf.test' });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [PERMISSION_CODES[0] as string],
    });
    await createMembership({
      userId: otherMember.id,
      organizationId: organization.id,
      roleId: role.id,
    });

    const ownerCodes = await service.resolveUserOrganizationPermissions(
      user.public_id,
      organization.public_id,
    );
    const otherCodes = await service.resolveUserOrganizationPermissions(
      otherMember.public_id,
      organization.public_id,
    );
    await service.resolveUserOrganizationPermissions(otherMember.public_id, organization.public_id);

    // One join per distinct (user, organization) — never zero (shared entry leaking one
    // member's codes to another) and never three (cache not hitting at all).
    expect(joinSpy).toHaveBeenCalledTimes(2);
    expect(ownerCodes.sort()).toEqual([...PERMISSION_CODES].sort());
    expect(otherCodes).toEqual([PERMISSION_CODES[0]]);
  });

  it('cache-bypassing resolution pays the join every time (no accidental caching on the strict path)', async () => {
    const { user, organization, service, joinSpy } = await createResolutionContext();

    await service.resolveUserOrganizationPermissionsFromDatabase(
      user.public_id,
      organization.public_id,
    );
    await service.resolveUserOrganizationPermissionsFromDatabase(
      user.public_id,
      organization.public_id,
    );

    // The strict path exists precisely so privilege-escalation guards never trust a stale
    // cached set (sec-r5-L3) — if it ever starts caching, that guarantee is gone.
    expect(joinSpy).toHaveBeenCalledTimes(2);
  });
});
