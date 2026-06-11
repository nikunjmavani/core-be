import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { createTestUserWithPassword } from '@/tests/factories/user.factory.js';
import { audit_outbox } from '@/domains/audit/audit-outbox.schema.js';
import type { FastifyInstance } from 'fastify';

// Audit writes go through the transactional outbox (P0-#2): the row is staged in
// `audit.outbox` synchronously within the request and the drain worker (not running
// in this test app) later copies it to `audit.logs`. Assert on the outbox — the
// synchronous durability point — and on the public-id actor column it stores.
describe('Security: mutation audit logs', () => {
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

  it('writes auth.login after successful login', async () => {
    const { user, password } = await createTestUserWithPassword();
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email: user.email, password },
    });
    expect(response.statusCode).toBe(200);

    const rows = await database
      .select()
      .from(audit_outbox)
      .where(eq(audit_outbox.action, 'auth.login'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_user_public_id).toBe(user.public_id);
    expect(rows[0]!.resource_type).toBe('session');
  });

  it('writes auth.logout after authenticated logout', async () => {
    const { user, password } = await createTestUserWithPassword();
    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email: user.email, password },
    });
    const accessToken = (loginResponse.json() as { data: { access_token: string } }).data
      .access_token;

    const logoutResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/logout'),
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const rows = await database
      .select()
      .from(audit_outbox)
      .where(eq(audit_outbox.action, 'auth.logout'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.actor_user_public_id === user.public_id)).toBe(true);
  });

  it('writes user.settings.update after PATCH /users/me/settings', async () => {
    const { user, password } = await createTestUserWithPassword();
    const loginResponse = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: { email: user.email, password },
    });
    const token = (loginResponse.json() as { data: { access_token: string } }).data.access_token;

    const response = await injectAuthenticated(app, {
      method: 'PATCH',
      url: testApiPath('/users/me/settings'),
      token,
      payload: { language: 'es' },
    });
    expect(response.statusCode).toBe(200);

    const rows = await database
      .select()
      .from(audit_outbox)
      .where(eq(audit_outbox.action, 'user.settings.update'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_user_public_id).toBe(user.public_id);
    expect(rows[0]!.resource_type).toBe('user_settings');
  });
});
