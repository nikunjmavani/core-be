import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { seedUploadForOrganization } from '@/tests/helpers/test-organization.js';
import { database } from '@/infrastructure/database/connection.js';
import { uploads } from '@/domains/upload/upload.schema.js';

/**
 * Cross-user (intra-tenant) BOLA on user-owned `auth-by-id` routes — model `user`
 * in route-authorization-model.json. Attacker = a different authenticated user;
 * the object is owned by the victim. Reads/mutations must be denied (404) and
 * writes must leave the row unchanged. Baselines prove the owner still succeeds,
 * so the guard is specific, not a blanket deny.
 *
 * First increment of the Phase 2 matrix: `upload`, which reuses the existing
 * seedUploadForOrganization fixture. Remaining `user`-model resources
 * (notification, session, mfa, auth-method, data-export) land as their factories
 * are added.
 */
describe('Security: cross-user BOLA — uploads (model: user)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  async function setupVictimUpload() {
    const victim = await createTestUser();
    const attacker = await createTestUser();
    const victimToken = await generateTestToken({ userId: victim.public_id });
    const attackerToken = await generateTestToken({ userId: attacker.public_id });
    const upload = await seedUploadForOrganization({ userId: victim.id });
    return { victim, attacker, victimToken, attackerToken, upload };
  }

  it("attacker GET of victim's upload → 404", async () => {
    const { attackerToken, upload } = await setupVictimUpload();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/uploads/${upload.public_id}`),
      token: attackerToken,
    });
    expect(response.statusCode).toBe(404);
  });

  it('baseline: owner GET of own upload → 200', async () => {
    const { victimToken, upload } = await setupVictimUpload();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/uploads/${upload.public_id}`),
      token: victimToken,
    });
    expect(response.statusCode).toBe(200);
  });

  it("attacker DELETE of victim's upload → 404 and row not soft-deleted (verifyNoMutation)", async () => {
    const { attackerToken, upload } = await setupVictimUpload();
    const response = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath(`/uploads/${upload.public_id}`),
      token: attackerToken,
    });
    expect(response.statusCode).toBe(404);

    const [row] = await database
      .select()
      .from(uploads)
      .where(eq(uploads.public_id, upload.public_id));
    expect(row?.deleted_at).toBeNull();
  });
});
