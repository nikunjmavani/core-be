import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

/**
 * Organization-slug uniqueness race (TOCTOU) at the HTTP layer.
 *
 * Creating an organization does a `findBySlug` pre-check then an INSERT — two
 * concurrent creates can both pass the pre-check, and the loser hits the
 * `idx_organizations_slug` unique index. The service maps that Postgres
 * unique_violation to a 409 (not a 500). This integration test fires concurrent
 * same-slug creates and asserts the invariant: exactly ONE succeeds, every other
 * is a clean 409 conflict, and NONE leak a 5xx — i.e. the race is serialized by
 * the DB constraint and handled gracefully.
 *
 * Each concurrent request carries a DISTINCT X-Idempotency-Key so the idempotency
 * layer does not dedupe them — the slug constraint is the only thing that may
 * serialize them.
 */
function tally(statuses: number[]): { created: number; conflict: number; serverError: number } {
  return {
    created: statuses.filter((s) => s === 201).length,
    conflict: statuses.filter((s) => s === 409).length,
    serverError: statuses.filter((s) => s >= 500).length,
  };
}

describe('Security: organization-slug uniqueness race (TOCTOU)', () => {
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

  async function token(): Promise<string> {
    const user = await createTestUser();
    return generateTestToken({ userId: user.public_id });
  }

  async function createWithSlug(authToken: string, slug: string): Promise<number> {
    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token: authToken,
      payload: { name: 'Race Org', slug },
      headers: { 'x-idempotency-key': generatePublicId('organization') },
    });
    return response.statusCode;
  }

  it('two concurrent creates with the same slug: exactly one 201, one 409, no 5xx', async () => {
    const authToken = await token();
    const slug = `race-${generatePublicId('organization').slice(4)}`;

    const statuses = await Promise.all([
      createWithSlug(authToken, slug),
      createWithSlug(authToken, slug),
    ]);

    const result = tally(statuses);
    expect(result.serverError).toBe(0);
    expect(result.created).toBe(1);
    expect(result.conflict).toBe(1);
  });

  it('five concurrent creates with the same slug: exactly one 201, four 409, no 5xx', async () => {
    const authToken = await token();
    const slug = `race-${generatePublicId('organization').slice(4)}`;

    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => createWithSlug(authToken, slug)),
    );

    const result = tally(statuses);
    expect(result.serverError).toBe(0);
    expect(result.created).toBe(1);
    expect(result.conflict).toBe(4);
  });

  it('a sequential duplicate slug is also a clean 409 (baseline)', async () => {
    const authToken = await token();
    const slug = `race-${generatePublicId('organization').slice(4)}`;

    expect(await createWithSlug(authToken, slug)).toBe(201);
    expect(await createWithSlug(authToken, slug)).toBe(409);
  });
});
