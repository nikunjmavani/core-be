import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  createMembership,
  createRoleWithPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { MemberInvitationRepository } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.repository.js';
import { member_invitations } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.schema.js';
import { hashInvitationToken } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.token.js';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 20_000 });

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

async function setupOrganizationWithMembership() {
  const owner = await createTestUser({ email: `owner-${Date.now()}-${Math.random()}@test.com` });
  const organization = await createTestOrganization({ ownerUserId: owner.id });
  const role = await createRoleWithPermissions({
    organizationId: organization.id,
    permissionCodes: [],
  });
  const membership = await createMembership({
    userId: owner.id,
    organizationId: organization.id,
    roleId: role.id,
  });
  return { owner, organization, membership };
}

async function createInvitations(
  repository: MemberInvitationRepository,
  membership_id: number,
  invited_by_user_id: number,
  count: number,
): Promise<void> {
  const baseCreatedAt = Date.now();
  for (let index = 0; index < count; index += 1) {
    const invitation = await repository.create({
      membership_id,
      email: `invitee-${index}-${baseCreatedAt}@test.com`,
      token_hash: hashInvitationToken(`token-${index}-${baseCreatedAt}-${Math.random()}`),
      invited_by_user_id,
      expires_at: new Date(Date.now() + ONE_DAY_MS),
      created_by_user_id: invited_by_user_id,
    });
    await database
      .update(member_invitations)
      .set({ created_at: new Date(baseCreatedAt + index * 1_000) })
      .where(eq(member_invitations.id, invitation.id));
  }
}

describe('MemberInvitationRepository.findByOrganizationId (keyset cursor pagination)', () => {
  const repository = new MemberInvitationRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('returns has_more=true with opaque next_cursor when more pages exist (no total by default)', async () => {
    const { owner, organization, membership } = await setupOrganizationWithMembership();
    await createInvitations(repository, membership.id, owner.id, 3);

    const page1 = await repository.findByOrganizationId(organization.id, { limit: 2 });

    expect(page1.items).toHaveLength(2);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBeTypeOf('string');
    expect(page1.total).toBeNull();
  });

  it('navigates pages with `after` cursor without repeating items', async () => {
    const { owner, organization, membership } = await setupOrganizationWithMembership();
    await createInvitations(repository, membership.id, owner.id, 3);

    const page1 = await repository.findByOrganizationId(organization.id, { limit: 2 });
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBeTypeOf('string');

    const page2 = await repository.findByOrganizationId(organization.id, {
      limit: 2,
      after: page1.next_cursor!,
    });

    const page1Ids = new Set(page1.items.map((item) => item.id));
    for (const item of page2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
    expect(page1.items.length + page2.items.length).toBe(3);
    expect(page2.has_more).toBe(false);
    expect(page2.next_cursor).toBeNull();
  });

  it('returns has_more=false and next_cursor=null when total fits exactly within limit', async () => {
    const { owner, organization, membership } = await setupOrganizationWithMembership();
    await createInvitations(repository, membership.id, owner.id, 2);

    const result = await repository.findByOrganizationId(organization.id, { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.has_more).toBe(false);
    expect(result.next_cursor).toBeNull();
  });

  it('returns empty page without total when there are no invitations', async () => {
    const { organization } = await setupOrganizationWithMembership();

    const result = await repository.findByOrganizationId(organization.id, { limit: 10 });

    expect(result.items).toEqual([]);
    expect(result.has_more).toBe(false);
    expect(result.next_cursor).toBeNull();
    expect(result.total).toBeNull();
  });

  it('returns total when include_total=true is requested', async () => {
    const { owner, organization, membership } = await setupOrganizationWithMembership();
    await createInvitations(repository, membership.id, owner.id, 3);

    const result = await repository.findByOrganizationId(organization.id, {
      limit: 2,
      include_total: true,
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.has_more).toBe(true);
  });

  it('scopes results to the requested organization (does not leak cross-organization invitations)', async () => {
    const contextA = await setupOrganizationWithMembership();
    const contextB = await setupOrganizationWithMembership();
    await createInvitations(repository, contextA.membership.id, contextA.owner.id, 2);
    await createInvitations(repository, contextB.membership.id, contextB.owner.id, 1);

    const resultA = await repository.findByOrganizationId(contextA.organization.id, {
      limit: 10,
      include_total: true,
    });
    const resultB = await repository.findByOrganizationId(contextB.organization.id, {
      limit: 10,
      include_total: true,
    });

    expect(resultA.items).toHaveLength(2);
    expect(resultA.total).toBe(2);
    expect(resultB.items).toHaveLength(1);
    expect(resultB.total).toBe(1);
  });

  it('orders invitations ascending by created_at and id (deterministic keyset)', async () => {
    const { owner, organization, membership } = await setupOrganizationWithMembership();
    await createInvitations(repository, membership.id, owner.id, 5);

    const result = await repository.findByOrganizationId(organization.id, { limit: 10 });
    const ids = result.items.map((item) => item.id);
    const sortedAsc = [...ids].sort((leftId, rightId) => leftId - rightId);
    expect(ids).toEqual(sortedAsc);
  });
});
