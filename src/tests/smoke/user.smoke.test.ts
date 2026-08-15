import { beforeAll, describe, it } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: user', () => {
  // One login per file — the shared STRICT public login limiter counts every
  // smoke login from one IP, so each extra login call burns headroom.
  let accessToken = '';
  beforeAll(async () => {
    ({ accessToken } = await smokeLogin());
  });

  it('GET /api/v1/users/me/settings returns 200', async () => {
    // Settings are auto-provisioned on first read, so a fresh smoke user still
    // gets a 200 — a 5xx here means the user domain wiring (or provisioning)
    // is broken in the running binary.
    await smokeFetch('/api/v1/users/me/settings', {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: 200,
    });
  });

  it('GET /api/v1/users/me/notification-preferences returns 200', async () => {
    await smokeFetch('/api/v1/users/me/notification-preferences', {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: 200,
    });
  });
});
