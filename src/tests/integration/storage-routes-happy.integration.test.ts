import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import type { FastifyInstance } from 'fastify';

/** PNG file signature so the confirm step's magic-byte verification passes. */
const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const FAKE_CONTENT_LENGTH = 1024;

vi.mock('@/infrastructure/storage/s3-adapter.js', () => {
  const fakeObjectStorage = {
    createPresignedUploadUrl: async () => 'https://fake-s3.local/presigned-put',
    createPresignedUploadPost: async () => ({
      url: 'https://fake-s3.local/upload',
      fields: { key: 'fake-policy-key' },
    }),
    verifyUploadedObject: async (
      _key: string,
      expected: { contentType: string; contentLength: number },
    ) => ({
      contentType: expected.contentType,
      contentLength: expected.contentLength,
      eTag: '"fake-etag"',
    }),
    headObject: async () => ({
      contentType: 'image/png',
      contentLength: FAKE_CONTENT_LENGTH,
    }),
    deleteObject: async () => true,
    putObject: async () => {},
    copyObject: async () => {},
    getObject: async () => ({ body: PNG_MAGIC_BYTES, contentType: 'image/png' }),
    getObjectFirstBytes: async () => ({
      body: PNG_MAGIC_BYTES,
      contentType: 'image/png',
      eTag: '"fake-etag"',
    }),
    getObjectUrl: (key: string) => `https://fake-s3.local/${key}`,
    createPresignedDownloadUrl: async () => 'https://fake-s3.local/presigned-get',
  };
  return {
    getDefaultS3ObjectStorageAdapter: () => fakeObjectStorage,
    S3ObjectStorageAdapter: class {},
  };
});

async function createUploadAndConfirm(options: {
  app: FastifyInstance;
  token: string;
  purpose: 'avatar' | 'organization-logo';
  target: 'user' | 'organization';
  organizationPublicId?: string;
}): Promise<{ uploadPublicId: string; key: string }> {
  const { app, token, purpose, target, organizationPublicId } = options;

  const create = await injectAuthenticated(app, {
    method: 'POST',
    url: testApiPath('/uploads'),
    token,
    ...(organizationPublicId ? { organizationPublicId } : {}),
    payload: {
      purpose,
      for: target,
      ...(organizationPublicId ? { organizationId: organizationPublicId } : {}),
      contentType: 'image/png',
      fileName: 'happy-path.png',
      fileSize: FAKE_CONTENT_LENGTH,
    },
  });
  expect(create.statusCode, create.body).toBe(201);
  // `key` is only exposed at create time ("final storage key to pass to attach
  // endpoints after POST /confirm succeeds"); the detail serializer hides it.
  const created = (create.json() as { data: { publicId: string; key: string } }).data;

  const confirm = await injectAuthenticated(app, {
    method: 'POST',
    url: testApiPath(`/uploads/${created.publicId}/confirm`),
    token,
    ...(organizationPublicId ? { organizationPublicId } : {}),
  });
  expect(confirm.statusCode, confirm.body).toBe(200);
  return { uploadPublicId: created.publicId, key: created.key };
}

/**
 * Happy paths for the storage-backed routes (S3 adapter mocked at the
 * ObjectStoragePort seam): upload delete (204), avatar attach (200), and
 * organization logo attach (200) — the three routes whose declared success
 * needs object storage to respond.
 */
describe('Storage-backed routes — happy paths (mocked S3 port)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('DELETE /uploads/:publicId returns 204 for an owned upload', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const { uploadPublicId } = await createUploadAndConfirm({
      app,
      token,
      purpose: 'avatar',
      target: 'user',
    });

    const response = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath(`/uploads/${uploadPublicId}`),
      token,
    });
    expect(response.statusCode, response.body).toBe(204);
  });

  it('PUT /users/me/avatar attaches a confirmed avatar upload', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const { key } = await createUploadAndConfirm({
      app,
      token,
      purpose: 'avatar',
      target: 'user',
    });

    const response = await injectAuthenticated(app, {
      method: 'PUT',
      url: testApiPath('/users/me/avatar'),
      token,
      payload: { avatarKey: key },
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('PUT /tenancy/organizations/:id/logo attaches a confirmed logo upload', async () => {
    // organization:update gates the logo attach; upload:manage gates creating
    // an organization-target upload in the first place.
    await seedPermissions(['organization:update', 'upload:manage']);
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ['organization:update', 'upload:manage'],
      createdByUserId: user.id,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    const { key } = await createUploadAndConfirm({
      app,
      token,
      purpose: 'organization-logo',
      target: 'organization',
      organizationPublicId: organization.public_id,
    });

    const response = await injectAuthenticatedOrganizationMutation(app, {
      method: 'PUT',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/logo`),
      token,
      organizationPublicId: organization.public_id,
      payload: { key },
    });
    expect(response.statusCode, response.body).toBe(200);
  });
});
