import { beforeAll, describe, it, expect } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

/**
 * The suite overview has always CLAIMED "idempotency middleware is wired (same key →
 * same response)" — this file makes the claim true. `POST /tenancy/organizations` is
 * the probe because it is the one `idempotencyRequired` write every authenticated user
 * may perform (no organization permission needed), so the smoke works with the plain
 * seeded user in every environment.
 */
describe('Smoke: idempotency middleware', () => {
  // One login per file — the shared STRICT public login limiter counts every
  // smoke login from one IP, so each extra login call burns headroom.
  let accessToken = '';
  beforeAll(async () => {
    ({ accessToken } = await smokeLogin());
  });

  it('rejects an idempotencyRequired write without X-Idempotency-Key (422, not 5xx)', async () => {
    await smokeFetch('/api/v1/tenancy/organizations', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: { name: 'Smoke idempotency probe', slug: `smoke-idem-missing-${suffix()}` },
      expectStatus: 422,
    });
  });

  it('replays the same X-Idempotency-Key as the identical response (no second execution)', async () => {
    const idempotencyKey = `smoke-idem-${suffix()}`;
    const body = { name: 'Smoke idempotency replay', slug: `smoke-idem-${suffix()}` };
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'x-idempotency-key': idempotencyKey,
    };

    const first = await smokeFetch('/api/v1/tenancy/organizations', {
      method: 'POST',
      headers,
      body,
      expectStatus: 200,
    });
    const second = await smokeFetch('/api/v1/tenancy/organizations', {
      method: 'POST',
      headers,
      body,
      expectStatus: 200,
    });

    const firstOrganization = ((await first.json()) as { data: { id: string; slug: string } }).data;
    const secondOrganization = ((await second.json()) as { data: { id: string; slug: string } })
      .data;

    // Same public id ⇒ the replay was served from the idempotency cache; a second
    // execution would have minted a different organization (or 409ed on the slug).
    expect(secondOrganization.id).toBe(firstOrganization.id);
    expect(secondOrganization.slug).toBe(firstOrganization.slug);
  });
});

/** Unique-enough suffix so repeated smoke runs never collide on slug or key. */
function suffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}
