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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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

/**
 * The service-layer test mocks `accept` to always succeed, and the service pre-check does NOT
 * verify the token (credential equality lives only in the repository WHERE). So the single-use,
 * wrong-token, and expiry guards have no behavioral coverage — a broken WHERE clause would ship
 * green. These exercise the real DB-level `accept`.
 */
describe('MemberInvitationRepository.accept (single-use + credential + expiry guards)', () => {
  const repository = new MemberInvitationRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  async function seedInvitation() {
    const { owner, membership } = await setupOrganizationWithMembership();
    const plainToken = `accept-token-${Date.now()}-${Math.random()}`;
    const invitation = await repository.create({
      membership_id: membership.id,
      email: `accept-${Date.now()}-${Math.random()}@test.com`,
      token_hash: hashInvitationToken(plainToken),
      invited_by_user_id: owner.id,
      expires_at: new Date(Date.now() + ONE_DAY_MS),
      created_by_user_id: owner.id,
    });
    return { invitation, plainToken };
  }

  async function readAcceptedAt(id: number): Promise<Date | null> {
    const rows = await database
      .select({ accepted_at: member_invitations.accepted_at })
      .from(member_invitations)
      .where(eq(member_invitations.id, id));
    return rows[0]?.accepted_at ?? null;
  }

  it('accepts once with the correct token, then rejects the replay (single-use)', async () => {
    const { invitation, plainToken } = await seedInvitation();
    const tokenHash = hashInvitationToken(plainToken);

    const first = await repository.accept(invitation.public_id, tokenHash, new Date());
    expect(first?.public_id).toBe(invitation.public_id);

    const replay = await repository.accept(invitation.public_id, tokenHash, new Date());
    expect(replay).toBeNull();
    expect(await readAcceptedAt(invitation.id)).not.toBeNull();
  });

  it('rejects a wrong token and leaves accepted_at null', async () => {
    const { invitation } = await seedInvitation();

    const result = await repository.accept(
      invitation.public_id,
      hashInvitationToken('a-different-token-entirely'),
      new Date(),
    );
    expect(result).toBeNull();
    expect(await readAcceptedAt(invitation.id)).toBeNull();
  });

  it('rejects an invitation whose expiry precedes the check time, even with the correct token', async () => {
    const { invitation, plainToken } = await seedInvitation();

    // The invitation is valid for 1 day; checking it 2 days out makes it expired relative to
    // the guard `gt(expires_at, expires_after)`. (A past-dated expires_at cannot be inserted —
    // the chk_member_inv_expires CHECK constraint forbids it — so the check time models "now".)
    const result = await repository.accept(
      invitation.public_id,
      hashInvitationToken(plainToken),
      new Date(Date.now() + 2 * ONE_DAY_MS),
    );
    expect(result).toBeNull();
    expect(await readAcceptedAt(invitation.id)).toBeNull();
  });

  it('lets exactly one of two concurrent accepts win', async () => {
    const { invitation, plainToken } = await seedInvitation();
    const tokenHash = hashInvitationToken(plainToken);
    const now = new Date();

    const results = await Promise.all([
      repository.accept(invitation.public_id, tokenHash, now),
      repository.accept(invitation.public_id, tokenHash, now),
    ]);
    expect(results.filter((row) => row !== null)).toHaveLength(1);
  });
});
