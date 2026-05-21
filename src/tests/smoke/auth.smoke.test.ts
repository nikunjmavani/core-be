import { describe, it, expect } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: auth', () => {
  it('login returns access token', async () => {
    const { accessToken } = await smokeLogin();
    expect(accessToken.length).toBeGreaterThan(10);
  });

  it('GET /api/v1/users/me with token returns 200', async () => {
    const { accessToken } = await smokeLogin();
    await smokeFetch('/api/v1/users/me', {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: 200,
    });
  });
});
