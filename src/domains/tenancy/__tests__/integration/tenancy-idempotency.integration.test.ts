import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedAllPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@/shared/constants/index.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

/**
 * Six tenancy writes are registered with `config.idempotencyRequired = true` (the `I = req` column
 * in `docs/routes.txt`), yet no tenancy test ever omitted the key — `injectRoute` auto-supplies one
 * for the create routes, and the suites that hit the rest pass an explicit key. Only
 * `POST /tenancy/organizations` had a missing-key assertion, and it lived in the platform
 * idempotency suite rather than in the domain.
 *
 * The consequence is that the *declaration* was untested: deleting `idempotencyRequired` from any of
 * these five route configs would not have failed a single tenancy test, while silently removing
 * replay protection from money- and membership-shaped writes.
 *
 * These tests deliberately call `app.inject` directly rather than the `injectAuthenticated` helper.
 * The helper exists to auto-add a key precisely so unrelated tests are not tripped by this contract
 * — using it here would make the assertion impossible to write.
 */

const ALL_TENANCY_PERMISSIONS = Object.values(TENANCY_PERMISSIONS);

type ErrorBody = { error?: { code?: string; detail?: string } };

describe('Tenancy idempotency contract — Integration', () => {
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
    await seedAllPermissions();
  });

  async function createOwnerContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ALL_TENANCY_PERMISSIONS,
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
    return { user, organization, role, token };
  }

  /** Raw inject — no auto-supplied `X-Idempotency-Key`. */
  async function injectWithoutIdempotencyKey(options: {
    method: 'POST';
    url: string;
    token: string;
    payload: unknown;
    key?: string;
  }) {
    return app.inject({
      method: options.method,
      url: options.url,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(options.key ? { 'x-idempotency-key': options.key } : {}),
      },
      payload: options.payload as never,
    });
  }

  /**
   * The five `idempotencyRequired` tenancy writes that had no missing-key assertion.
   * `POST /tenancy/organizations` is the sixth and is already covered by the platform suite.
   *
   * The bodies must be schema-valid: Fastify runs body validation before `preHandler`, so an
   * invalid payload would answer 400 and never reach the idempotency claim. They need not be
   * *accepted* by the handler — the claim preHandler rejects first — but they must parse.
   */
  const REQUIRED_KEY_WRITES: { name: string; path: string; payload: Record<string, unknown> }[] = [
    {
      name: 'POST /organization/api-keys',
      path: '/tenancy/organization/api-keys',
      payload: { name: 'ci-key', scopes: [TENANCY_PERMISSIONS.ORGANIZATION_READ] },
    },
    {
      name: 'POST /organization/memberships',
      path: '/tenancy/organization/memberships',
      // `role_id` is required by the DTO; any well-formed id parses, and the claim preHandler
      // rejects before the handler would resolve it.
      payload: { email: 'invitee@example.com', role_id: 'rol_aaaaaaaaaaaaaaaaaaaaa' },
    },
    {
      name: 'POST /organization/notification-policies',
      path: '/tenancy/organization/notification-policies',
      payload: {
        notification_type: NOTIFICATION_TYPES[0],
        channel: NOTIFICATION_CHANNELS[0],
      },
    },
    {
      name: 'POST /organization/roles',
      path: '/tenancy/organization/roles',
      payload: { name: 'Auditor', description: 'read only' },
    },
    {
      name: 'POST /organization/transfer-ownership',
      path: '/tenancy/organization/transfer-ownership',
      payload: { new_owner_user_id: 'usr_aaaaaaaaaaaaaaaaaaaaa' },
    },
  ];

  describe('a missing X-Idempotency-Key is rejected with 422 on every required write', () => {
    it.each(REQUIRED_KEY_WRITES)('$name → 422', async ({ path, payload }) => {
      const { token } = await createOwnerContext();
      const response = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath(path),
        token,
        payload,
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body) as ErrorBody;
      expect(body.error?.code).toBe('unprocessable_entity');
      // `errors:idempotencyKeyRequired`, rendered in the default (en) locale.
      expect(body.error?.detail).toBe('X-Idempotency-Key header is required for this operation');
    });
  });

  describe('a malformed X-Idempotency-Key is rejected with 422 (not 400) on every required write', () => {
    // On a required route a malformed key is a violated contract, not ordinary request validation —
    // the 400 that optional-key routes return would let a client believe the write was protected.
    it.each(REQUIRED_KEY_WRITES)('$name → 422', async ({ path, payload }) => {
      const { token } = await createOwnerContext();
      const response = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath(path),
        token,
        payload,
        key: 'bad key with spaces',
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body) as ErrorBody;
      expect(body.error?.code).toBe('unprocessable_entity');
      // `errors:idempotencyKeyInvalid` — distinct from the missing-key copy above, so a regression
      // that collapsed the two cases into one message would fail here.
      expect(body.error?.detail).toBe(
        'X-Idempotency-Key must be 16–255 characters and use only letters, digits, and . _ : ~ + / = -',
      );
    });
  });

  describe('replay protection on POST /organization/roles', () => {
    it('replays the first response for a repeated key instead of creating a second role', async () => {
      const { token } = await createOwnerContext();
      const key = `idem-${randomUUID()}`;
      const payload = { name: 'Auditor', description: 'read only' };

      const first = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        payload,
        key,
      });
      expect(first.statusCode).toBe(201);
      expect(first.headers['x-idempotency-replay']).toBeUndefined();
      const firstId = (JSON.parse(first.body) as { data: { id: string } }).data.id;

      const replay = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        payload,
        key,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotency-replay']).toBe('true');
      expect((JSON.parse(replay.body) as { data: { id: string } }).data.id).toBe(firstId);

      // The response layer alone cannot tell a replay from a second create — assert the row count.
      const list = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organization/roles'),
        token,
      });
      expect(list.statusCode).toBe(200);
      const roleNames = (list.json() as { data: { name: string }[] }).data.map((role) => role.name);
      expect(roleNames.filter((name) => name === 'Auditor')).toHaveLength(1);
    });

    it('rejects the same key with a different body as a fingerprint mismatch (422)', async () => {
      const { token } = await createOwnerContext();
      const key = `idem-${randomUUID()}`;

      const first = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        payload: { name: 'First Role' },
        key,
      });
      expect(first.statusCode).toBe(201);

      const mismatch = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        payload: { name: 'Second Role' },
        key,
      });
      expect(mismatch.statusCode).toBe(422);
    });
  });

  describe('POST /organization/api-keys is required-key AND replay-excluded', () => {
    // This route sits in `IDEMPOTENCY_EXCLUDED_ROUTE_PATTERNS`: its 201 body carries the raw secret
    // exactly once, so caching it would let a replayed request re-read a live credential out of
    // Redis. The result is a deliberate and easily-missed combination — the key is *mandatory*
    // (asserted above) but never *dedupes*. Nothing pinned that pairing before; dropping the route
    // from the exclusion list would have turned the secret into a replayable cache entry silently.
    it('mints a second, distinct key when the same X-Idempotency-Key is reused', async () => {
      const { token } = await createOwnerContext();
      const key = `idem-${randomUUID()}`;
      const payload = { name: 'ci-key', scopes: [TENANCY_PERMISSIONS.ORGANIZATION_READ] };

      const first = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath('/tenancy/organization/api-keys'),
        token,
        payload,
        key,
      });
      const second = await injectWithoutIdempotencyKey({
        method: 'POST',
        url: testApiPath('/tenancy/organization/api-keys'),
        token,
        payload,
        key,
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      // Never a replay — neither response may be served from the idempotency cache.
      expect(first.headers['x-idempotency-replay']).toBeUndefined();
      expect(second.headers['x-idempotency-replay']).toBeUndefined();

      type ApiKeyBody = { data: { api_key: { id: string }; raw_key: string } };
      const firstBody = JSON.parse(first.body) as ApiKeyBody;
      const secondBody = JSON.parse(second.body) as ApiKeyBody;
      expect(secondBody.data.api_key.id).not.toBe(firstBody.data.api_key.id);
      // Two independent secrets — a cached replay would have handed back the first raw key.
      expect(secondBody.data.raw_key).not.toBe(firstBody.data.raw_key);
    });
  });
});
