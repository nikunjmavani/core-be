import { describe, it } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: billing', () => {
  it('GET /api/v1/billing/plans is reachable', async () => {
    const { accessToken } = await smokeLogin();
    await smokeFetch('/api/v1/billing/plans', {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: 200,
    });
  });
});
