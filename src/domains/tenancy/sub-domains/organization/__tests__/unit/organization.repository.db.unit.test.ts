import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import {
  createMembership,
  createRoleWithPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';

describe('OrganizationRepository (database)', () => {
  const repository = new OrganizationRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('returns an empty page when no organizations exist', async () => {
    const emptyPage = await repository.findAll({ limit: 20 });
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.total).toBeNull();
  });

  it('creates, queries, updates, and soft-deletes organizations', async () => {
    const owner = await createTestUser({ email: 'org-owner@example.com' });

    const created = await repository.create({
      name: 'Acme Corp',
      slug: 'acme-corp',
      owner_user_id: owner.id,
      created_by_user_id: owner.id,
    });

    const byPublicId = await repository.findByPublicId(created.public_id);
    expect(byPublicId?.slug).toBe('acme-corp');

    const bySlug = await repository.findBySlug('acme-corp');
    expect(bySlug?.public_id).toBe(created.public_id);

    const byId = await repository.findById(created.id);
    expect(byId?.name).toBe('Acme Corp');

    const resolvedOwnerId = await repository.resolveUserIdByPublicId(owner.public_id);
    expect(resolvedOwnerId).toBe(owner.id);

    const page = await repository.findAll({ limit: 20 });
    expect(page.items.some((row) => row.public_id === created.public_id)).toBe(true);

    await repository.updateStripeCustomerId(created.id, 'cus_test_123');
    const withStripe = await repository.findByPublicId(created.public_id);
    expect(withStripe?.stripe_customer_id).toBe('cus_test_123');
    expect(await repository.updateStripeCustomerId(99_999, 'cus_missing')).toBeNull();

    const updated = await repository.update(created.public_id, { name: 'Acme Updated' }, owner.id);
    expect(updated?.name).toBe('Acme Updated');

    const updatedWithNullUpdater = await repository.update(
      created.public_id,
      { status: 'ACTIVE' },
      null,
    );
    expect(updatedWithNullUpdater?.status).toBe('ACTIVE');

    const byStripe = await repository.findByStripeCustomerId('cus_test_123');
    expect(byStripe?.public_id).toBe(created.public_id);
    expect(await repository.findByStripeCustomerId('cus_missing')).toBeNull();

    await repository.updateOwner(created.public_id, owner.id);

    // Soft-delete is two-phase: deletion must be marked started before it can be finalized.
    expect(await repository.softDelete(created.public_id)).toBeNull();
    const markedForDeletion = await repository.markDeletionStarted(created.public_id);
    expect(markedForDeletion?.deletion_started_at).not.toBeNull();

    const deleted = await repository.softDelete(created.public_id);
    expect(deleted?.deleted_at).not.toBeNull();
    expect(await repository.softDelete(created.public_id)).toBeNull();

    expect(await repository.findByPublicId(created.public_id)).toBeNull();
    expect(await repository.findBySlug('acme-corp')).toBeNull();
    expect(await repository.findById(created.id)).toBeNull();
    expect(await repository.resolveUserIdByPublicId('missing_user_public_id')).toBeNull();

    const withoutCreator = await repository.create({
      name: 'No Creator Org',
      slug: 'no-creator-org',
      owner_user_id: owner.id,
      created_by_user_id: null,
    });
    expect(withoutCreator.name).toBe('No Creator Org');

    expect(await repository.update('missing_org', { name: 'X' }, owner.id)).toBeNull();
    expect(await repository.updateOwner('missing_org', owner.id)).toBeNull();
  });

  // sec-new-D1: updateStripeCustomerId must include isNull(deleted_at) in its WHERE clause
  // so that a soft-deleted organization cannot have its Stripe customer id silently
  // (re-)assigned. Without the guard, a ghost row could resurface in Stripe lookup
  // and attach a new subscription to a deleted tenant.
  it('updateStripeCustomerId returns null for a soft-deleted organization (sec-new-D1)', async () => {
    const owner = await createTestUser({ email: 'stripe-cid-deleted@example.com' });
    const organization = await repository.create({
      name: 'Deleted Stripe Org',
      slug: 'deleted-stripe-org',
      owner_user_id: owner.id,
      created_by_user_id: owner.id,
    });

    // Soft-delete requires marking deletion as started first.
    await repository.markDeletionStarted(organization.public_id);
    await repository.softDelete(organization.public_id);

    // Must return null — soft-deleted org must not be assigned a Stripe customer id.
    const result = await repository.updateStripeCustomerId(organization.id, 'cus_ghost_123');
    expect(result).toBeNull();
  });

  it('updateOwner transfers only to a member who is still active (atomic TOCTOU guard)', async () => {
    const owner = await createTestUser({ email: 'transfer-owner@example.com' });
    const organization = await repository.create({
      name: 'Transfer Org',
      slug: 'transfer-org',
      owner_user_id: owner.id,
      created_by_user_id: owner.id,
    });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [],
    });

    // An active member can receive ownership.
    const activeMember = await createTestUser({ email: 'active-new-owner@example.com' });
    await createMembership({
      userId: activeMember.id,
      organizationId: organization.id,
      roleId: role.id,
      status: 'ACTIVE',
    });
    const transferred = await repository.updateOwner(organization.public_id, activeMember.id);
    expect(transferred?.owner_user_id).toBe(activeMember.id);

    // A suspended member must NOT — this is the race outcome the guard blocks. updateOwner
    // matches zero rows and the owner is left unchanged.
    const suspendedMember = await createTestUser({ email: 'suspended-new-owner@example.com' });
    await createMembership({
      userId: suspendedMember.id,
      organizationId: organization.id,
      roleId: role.id,
      status: 'SUSPENDED',
    });
    expect(await repository.updateOwner(organization.public_id, suspendedMember.id)).toBeNull();

    // A non-member is likewise rejected.
    const stranger = await createTestUser({ email: 'stranger-new-owner@example.com' });
    expect(await repository.updateOwner(organization.public_id, stranger.id)).toBeNull();

    // The owner remains the active member from the only successful transfer.
    const finalState = await repository.findByPublicId(organization.public_id);
    expect(finalState?.owner_user_id).toBe(activeMember.id);
  });
});
