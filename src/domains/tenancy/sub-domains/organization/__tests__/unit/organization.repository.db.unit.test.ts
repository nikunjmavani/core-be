import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';

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
});
