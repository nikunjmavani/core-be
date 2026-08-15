import { describe, it } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: audit', () => {
  it('GET /api/v1/audit/logs is reachable and role-gated without 5xx', async () => {
    // The platform audit log is ROLE-gated (super_admin/admin). The smoke user is a
    // plain `user`, so 403 is the healthy answer — it proves the route is registered
    // AND the global-role guard is active in the running binary. 200 covers a smoke
    // environment whose seeded user carries an admin role. A 5xx (or a 404 from a
    // missing registration) fails the gate.
    const { accessToken } = await smokeLogin();
    await smokeFetch('/api/v1/audit/logs', {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: [200, 403],
    });
  });
});
