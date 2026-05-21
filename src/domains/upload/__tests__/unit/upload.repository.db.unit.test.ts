import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { UploadRepository } from '@/domains/upload/upload.repository.js';

describe('UploadRepository (database)', () => {
  const repository = new UploadRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates and finds uploads by public id for user and organization', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    const created = await repository.create({
      user_id: user.id,
      organization_id: organization.id,
      file_name: 'logo.png',
      file_key: 'organization-logos/logo.png',
      mime_type: 'image/png',
      file_size: 2048,
      storage_provider: 's3',
      bucket: 'test-bucket',
    });

    const byPublicId = await repository.findByPublicId(created.public_id);
    expect(byPublicId?.file_name).toBe('logo.png');

    const forUser = await repository.findByPublicIdForUser(created.public_id, user.id);
    expect(forUser?.public_id).toBe(created.public_id);

    const missing = await repository.findByPublicId('nonexistent_public_id');
    expect(missing).toBeNull();
  });

  it('soft-deletes all uploads for a user', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    await repository.create({
      user_id: user.id,
      organization_id: organization.id,
      file_name: 'a.png',
      file_key: 'a.png',
      mime_type: 'image/png',
      file_size: 100,
      storage_provider: 's3',
      bucket: 'test',
    });

    const deletedCount = await repository.softDeleteAllByUserId(user.id);
    expect(deletedCount).toBeGreaterThanOrEqual(1);
  });
});
