import { describe, it } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: notify', () => {
  it('lists organizations then webhooks without 5xx', async () => {
    const { accessToken } = await smokeLogin();
    const organizationsResponse = await smokeFetch('/api/v1/tenancy/organizations', {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: 200,
    });
    const organizationsJson = (await organizationsResponse.json()) as {
      data?: Array<{ id: string }>;
    };
    const organizationId = organizationsJson.data?.[0]?.id;
    if (!organizationId) return;

    await smokeFetch(`/api/v1/notify/organizations/${organizationId}/webhooks`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-organization-id': organizationId,
      },
      expectStatus: [200, 403],
    });
  });
});
