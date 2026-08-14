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
import { buildUserAvatarKeyPrefix } from '@/domains/upload/upload.constants.js';
import enErrors from '@/shared/locales/en/errors.json' with { type: 'json' };
import type { FastifyInstance } from 'fastify';
import type { InjectHttpResult } from '@/tests/helpers/test-http-inject.helper.js';

/**
 * Mutable knobs for the mocked object-storage port. `vi.mock` factories are hoisted above
 * module scope, so the state they read has to be hoisted with them.
 */
const storageMock = vi.hoisted(() => ({
  /** When false, `getObjectFirstBytes` returns bytes that fail the PNG magic-byte check. */
  magicBytesValid: true,
}));

/** PNG file signature — the bytes a confirm step must see to accept an `image/png` object. */
const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
/** Plain ASCII — valid bytes for nothing, so magic-byte verification fails on them. */
const NOT_PNG_BYTES = Buffer.from('this is definitely not a png', 'utf8');
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
    // Always resolves: the attach routes HEAD the object before consulting the upload
    // row, so a permissive HEAD is what lets these tests reach the ownership /
    // confirmed-state guards that are actually under test.
    headObject: async () => ({
      contentType: 'image/png',
      contentLength: FAKE_CONTENT_LENGTH,
    }),
    deleteObject: async () => true,
    putObject: async () => {},
    copyObject: async () => {},
    getObject: async () => ({ body: PNG_MAGIC_BYTES, contentType: 'image/png' }),
    getObjectFirstBytes: async () => ({
      body: storageMock.magicBytesValid ? PNG_MAGIC_BYTES : NOT_PNG_BYTES,
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

const AVATAR_URL = '/users/me/avatar';
const ORGANIZATION_LOGO_URL = '/tenancy/organization/logo';

interface AttachErrorBody {
  error: {
    type: string;
    code: string;
    detail: string;
    errors?: { field: string; message: string }[];
  };
}

/**
 * Every refusal on these routes is a 400 `validation_error` / `invalid_field`. The
 * discriminator is `detail` — which of the two guards fired — plus the offending field.
 */
function expectAttachRefused(
  response: InjectHttpResult,
  expected: { detail: string; field: string },
): void {
  expect(response.statusCode, response.body).toBe(400);
  const body = response.json() as AttachErrorBody;
  expect(body.error.type).toBe('validation_error');
  expect(body.error.code).toBe('invalid_field');
  expect(body.error.detail).toBe(expected.detail);
  expect(body.error.errors?.map((item) => item.field)).toContain(expected.field);
}

/**
 * Refusal paths for the storage-backed attach routes — the negative twin of
 * `storage-routes-happy.integration.test.ts`, which walks request → confirm → attach only
 * when every step succeeds.
 *
 * Two guards stand between a client-supplied storage key and a persisted avatar / logo,
 * and each route hits them in this order:
 *
 * 1. **Key-prefix ownership** — the key must sit under `avatars/{userPublicId}/` or
 *    `organization-logos/{organizationPublicId}/`, derived from the authenticated caller.
 * 2. **`UploadService.assertKeyConfirmedForOwner`** — an upload row must exist *at that
 *    final key* and be `UPLOADED`, then be bound to the same owner.
 *
 * Guard 2 is defense-in-depth for a future caller that does not derive the key from the
 * prefix convention, so over HTTP the two are partly redundant by design: a foreign key is
 * always stopped by guard 1, and guard 2's owner-mismatch arms are therefore unreachable
 * from these routes. What guard 2 uniquely catches here is *lifecycle* — a row that is
 * PENDING or FAILED still carries the `pending/`-namespaced `file_key`, so the final key
 * resolves to no row at all until confirm repoints it. Its status and owner-mismatch arms
 * need a direct unit test on the service.
 */
describe('Storage-backed attach routes — refusals (mocked S3 port)', () => {
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
    storageMock.magicBytesValid = true;
  });

  /**
   * Requests a presigned upload and returns the **final** attach key. The row is left
   * PENDING — the key is not resolvable until `POST /confirm` repoints the row at it.
   */
  async function requestUpload(options: {
    token: string;
    purpose: 'avatar' | 'organization-logo';
    target: 'user' | 'organization';
    organizationPublicId?: string;
  }): Promise<{ uploadPublicId: string; key: string }> {
    const { token, purpose, target, organizationPublicId } = options;
    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/uploads'),
      token,
      ...(organizationPublicId ? { organizationPublicId } : {}),
      payload: {
        purpose,
        for: target,
        ...(organizationPublicId ? { organization_id: organizationPublicId } : {}),
        content_type: 'image/png',
        file_name: 'attach-negative.png',
        file_size: FAKE_CONTENT_LENGTH,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = (response.json() as { data: { id: string; key: string } }).data;
    return { uploadPublicId: created.id, key: created.key };
  }

  async function confirmUpload(options: {
    token: string;
    uploadPublicId: string;
    organizationPublicId?: string;
  }): Promise<InjectHttpResult> {
    const { token, uploadPublicId, organizationPublicId } = options;
    return injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/uploads/${uploadPublicId}/confirm`),
      token,
      ...(organizationPublicId ? { organizationPublicId } : {}),
    });
  }

  /** Walks request → confirm and returns the now-attachable final key. */
  async function requestAndConfirmUpload(options: {
    token: string;
    purpose: 'avatar' | 'organization-logo';
    target: 'user' | 'organization';
    organizationPublicId?: string;
  }): Promise<string> {
    const { uploadPublicId, key } = await requestUpload(options);
    const confirm = await confirmUpload({
      token: options.token,
      uploadPublicId,
      ...(options.organizationPublicId
        ? { organizationPublicId: options.organizationPublicId }
        : {}),
    });
    expect(confirm.statusCode, confirm.body).toBe(201);
    return key;
  }

  async function attachAvatar(token: string, avatarKey: string): Promise<InjectHttpResult> {
    return injectAuthenticated(app, {
      method: 'PUT',
      url: testApiPath(AVATAR_URL),
      token,
      payload: { avatar_key: avatarKey },
    });
  }

  /** Creates a user, an organization they own, and a token scoped to that organization. */
  async function createOrganizationManager(): Promise<{
    token: string;
    organizationPublicId: string;
  }> {
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
    const token = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organization.public_id,
    });
    return { token, organizationPublicId: organization.public_id };
  }

  describe('PUT /users/me/avatar', () => {
    it('refuses a key whose upload is still PENDING', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const { key } = await requestUpload({ token, purpose: 'avatar', target: 'user' });

      expectAttachRefused(await attachAvatar(token, key), {
        detail: enErrors.validation.uploadNotConfirmed,
        field: 'key',
      });
    });

    it('refuses a key whose upload was confirmed and FAILED verification', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const { uploadPublicId, key } = await requestUpload({
        token,
        purpose: 'avatar',
        target: 'user',
      });

      // Spoofed content: the object HEADs as image/png but its leading bytes are not a
      // PNG, so confirm marks the row FAILED instead of UPLOADED.
      storageMock.magicBytesValid = false;
      const confirm = await confirmUpload({ token, uploadPublicId });
      expect(confirm.statusCode, confirm.body).toBe(400);
      expect((confirm.json() as AttachErrorBody).error.detail).toBe(
        enErrors.uploadVerificationFailed,
      );
      storageMock.magicBytesValid = true;

      expectAttachRefused(await attachAvatar(token, key), {
        detail: enErrors.validation.uploadNotConfirmed,
        field: 'key',
      });
    });

    it("refuses another user's confirmed avatar key", async () => {
      const owner = await createTestUser();
      const ownerToken = await generateTestToken({ userId: owner.public_id });
      const ownerKey = await requestAndConfirmUpload({
        token: ownerToken,
        purpose: 'avatar',
        target: 'user',
      });

      const attacker = await createTestUser();
      const attackerToken = await generateTestToken({ userId: attacker.public_id });

      // The key-prefix guard fires first — an attacker never reaches the upload row,
      // so `avatar_key` (not `key`) is the field reported back.
      expectAttachRefused(await attachAvatar(attackerToken, ownerKey), {
        detail: enErrors.validation.avatarKeyNotOwned,
        field: 'avatar_key',
      });
    });

    it("refuses a nonexistent key under the caller's own prefix", async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const forgedKey = `${buildUserAvatarKeyPrefix(user.public_id)}never-uploaded.png`;

      // Passes the DTO and the prefix guard; refused because no upload row owns it.
      expectAttachRefused(await attachAvatar(token, forgedKey), {
        detail: enErrors.validation.uploadNotConfirmed,
        field: 'key',
      });
    });
  });

  describe('PUT /tenancy/organization/logo', () => {
    beforeEach(async () => {
      await seedPermissions(['organization:update', 'upload:manage']);
    });

    it("refuses another organization's confirmed logo key", async () => {
      const foreign = await createOrganizationManager();
      const foreignKey = await requestAndConfirmUpload({
        token: foreign.token,
        purpose: 'organization-logo',
        target: 'organization',
        organizationPublicId: foreign.organizationPublicId,
      });

      const caller = await createOrganizationManager();
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PUT',
        url: testApiPath(ORGANIZATION_LOGO_URL),
        token: caller.token,
        organizationPublicId: caller.organizationPublicId,
        payload: { key: foreignKey },
      });

      expectAttachRefused(response, {
        detail: enErrors.validation.logoKeyNotOwned,
        field: 'key',
      });
    });

    it('refuses its own key while the upload is still PENDING', async () => {
      const caller = await createOrganizationManager();
      const { key } = await requestUpload({
        token: caller.token,
        purpose: 'organization-logo',
        target: 'organization',
        organizationPublicId: caller.organizationPublicId,
      });

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PUT',
        url: testApiPath(ORGANIZATION_LOGO_URL),
        token: caller.token,
        organizationPublicId: caller.organizationPublicId,
        payload: { key },
      });

      expectAttachRefused(response, {
        detail: enErrors.validation.uploadNotConfirmed,
        field: 'key',
      });
    });
  });
});
