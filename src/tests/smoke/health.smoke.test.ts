import { describe, it } from 'vitest';
import { smokeFetch } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: health', () => {
  it('GET /livez returns 200', async () => {
    await smokeFetch('/livez', { expectStatus: 200 });
  });

  it('GET /readyz returns ok or degraded when Redis is optional locally', async () => {
    await smokeFetch('/readyz', { expectStatus: [200, 503] });
  });
});
