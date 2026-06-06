import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { UploadRepository } from '@/domains/upload/upload.repository.js';

describe('UploadRepository user/organization isolation (database)', () => {
  const repository = new UploadRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('findByPublicIdForUser does not return another user\u2019s upload', async () => {
    const ownerUser = await createTestUser({ email: 'owner-isolation@example.com' });
    const otherUser = await createTestUser({ email: 'other-isolation@example.com' });

    const created = await repository.create({
      user_id: ownerUser.id,
      organization_id: null,
      file_name: 'owner-photo.png',
      file_key: `user-files/${ownerUser.id}/owner-photo.png`,
      mime_type: 'image/png',
      file_size: 1024,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    const forOwner = await repository.findByPublicIdForUser(created.public_id, ownerUser.id);
    expect(forOwner?.public_id).toBe(created.public_id);

    const forOther = await repository.findByPublicIdForUser(created.public_id, otherUser.id);
    expect(forOther).toBeNull();
  });

  it('findByPublicIdForUser does not return soft-deleted upload', async () => {
    const ownerUser = await createTestUser({ email: 'soft-delete-isolation@example.com' });

    const created = await repository.create({
      user_id: ownerUser.id,
      organization_id: null,
      file_name: 'soft.png',
      file_key: `user-files/${ownerUser.id}/soft.png`,
      mime_type: 'image/png',
      file_size: 512,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    const beforeDelete = await repository.findByPublicIdForUser(created.public_id, ownerUser.id);
    expect(beforeDelete?.public_id).toBe(created.public_id);

    const softDeleted = await repository.softDelete(created.public_id, ownerUser.id);
    expect(softDeleted?.deleted_at).not.toBeNull();

    const afterDelete = await repository.findByPublicIdForUser(created.public_id, ownerUser.id);
    expect(afterDelete).toBeNull();

    // sec-D12: keyset variant; production callers always paginate.
    const findActive = await repository.findActiveByUserIdAfter(ownerUser.id, 0, 100);
    expect(findActive.some((row) => row.id === created.id)).toBe(false);
  });

  it('findActiveByOrganizationIdAfter only returns uploads scoped to that organization (sec-D12)', async () => {
    const ownerUser = await createTestUser({ email: 'org-isolation@example.com' });
    const organizationA = await createTestOrganization({ ownerUserId: ownerUser.id });
    const organizationB = await createTestOrganization({ ownerUserId: ownerUser.id });

    const inOrgA = await repository.create({
      user_id: ownerUser.id,
      organization_id: organizationA.id,
      file_name: 'logo-a.png',
      file_key: `organization-files/${organizationA.id}/logo-a.png`,
      mime_type: 'image/png',
      file_size: 1024,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    const inOrgB = await repository.create({
      user_id: ownerUser.id,
      organization_id: organizationB.id,
      file_name: 'logo-b.png',
      file_key: `organization-files/${organizationB.id}/logo-b.png`,
      mime_type: 'image/png',
      file_size: 1024,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    const userScopedUpload = await repository.create({
      user_id: ownerUser.id,
      organization_id: null,
      file_name: 'user-only.png',
      file_key: `user-files/${ownerUser.id}/user-only.png`,
      mime_type: 'image/png',
      file_size: 512,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    const activeInOrgA = await repository.findActiveByOrganizationIdAfter(organizationA.id, 0, 100);
    const idsInOrgA = activeInOrgA.map((row) => row.id);
    expect(idsInOrgA).toContain(inOrgA.id);
    expect(idsInOrgA).not.toContain(inOrgB.id);
    expect(idsInOrgA).not.toContain(userScopedUpload.id);

    const activeInOrgB = await repository.findActiveByOrganizationIdAfter(organizationB.id, 0, 100);
    const idsInOrgB = activeInOrgB.map((row) => row.id);
    expect(idsInOrgB).toContain(inOrgB.id);
    expect(idsInOrgB).not.toContain(inOrgA.id);
    expect(idsInOrgB).not.toContain(userScopedUpload.id);
  });
});
