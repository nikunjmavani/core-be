import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { seedPermissions } from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { provisionPersonalOrganization } from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import {
  resolveDefaultActiveOrganizationPublicId,
  findUserActiveOrganizationPublicId,
  resolvePersonalOrganizationPublicId,
} from '@/domains/tenancy/sub-domains/organization/resolve-active-organization.js';

describe('personal organization provisioning (database)', () => {
  beforeEach(async () => {
    await cleanupDatabase();
    // The owner role is granted every tenancy permission; the codes must exist as reference rows.
    await seedPermissions(Object.values(TENANCY_PERMISSIONS));
  });

  it('provisions a PERSONAL organization with a null slug owned by the user', async () => {
    const user = await createTestUser();

    const result = await provisionPersonalOrganization(user.id);

    expect(result.organization.type).toBe('PERSONAL');
    expect(result.organization.slug).toBeNull();
    expect(result.organization.owner_user_id).toBe(user.id);
    expect(result.organization.public_id).toMatch(/^org_[a-z0-9]{21}$/);
    expect(result.membershipPublicId).toMatch(/^mem_[a-z0-9]{21}$/);
  });

  it('enforces at most one personal organization per owner', async () => {
    const user = await createTestUser();
    await provisionPersonalOrganization(user.id);

    // The idx_org_one_personal_per_owner partial unique index rejects a second one.
    await expect(provisionPersonalOrganization(user.id)).rejects.toThrow();
  });

  it('provisions independent personal organizations for different users', async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const a = await provisionPersonalOrganization(userA.id);
    const b = await provisionPersonalOrganization(userB.id);

    expect(a.organization.public_id).not.toBe(b.organization.public_id);
    expect(a.organization.owner_user_id).toBe(userA.id);
    expect(b.organization.owner_user_id).toBe(userB.id);
  });

  describe('resolveDefaultActiveOrganizationPublicId (login selection)', () => {
    it('returns the personal organization for a freshly provisioned user', async () => {
      const user = await createTestUser();
      const { organization } = await provisionPersonalOrganization(user.id);

      const resolved = await resolveDefaultActiveOrganizationPublicId(user.id);

      expect(resolved).toBe(organization.public_id);
    });

    it('returns undefined when the user belongs to no organization', async () => {
      const user = await createTestUser();

      const resolved = await resolveDefaultActiveOrganizationPublicId(user.id);

      expect(resolved).toBeUndefined();
    });
  });

  describe('switch-target resolvers', () => {
    it('resolvePersonalOrganizationPublicId returns the user personal org', async () => {
      const user = await createTestUser();
      const { organization } = await provisionPersonalOrganization(user.id);

      expect(await resolvePersonalOrganizationPublicId(user.id)).toBe(organization.public_id);
    });

    it('resolvePersonalOrganizationPublicId returns undefined without a personal org', async () => {
      const user = await createTestUser();
      expect(await resolvePersonalOrganizationPublicId(user.id)).toBeUndefined();
    });

    it('findUserActiveOrganizationPublicId confirms the owner active membership', async () => {
      const user = await createTestUser();
      const { organization } = await provisionPersonalOrganization(user.id);

      expect(await findUserActiveOrganizationPublicId(user.id, organization.public_id)).toBe(
        organization.public_id,
      );
    });

    it('findUserActiveOrganizationPublicId rejects a non-member organization', async () => {
      const member = await createTestUser();
      const stranger = await createTestUser();
      const { organization } = await provisionPersonalOrganization(member.id);

      // The stranger has no membership in the member's personal org → undefined (→ 403).
      expect(
        await findUserActiveOrganizationPublicId(stranger.id, organization.public_id),
      ).toBeUndefined();
    });
  });
});
