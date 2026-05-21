import { describe, it } from 'vitest';
import { smokeFetch } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: health', () => {
  it('GET /health/live returns 200', async () => {
    await smokeFetch('/health/live', { expectStatus: 200 });
  });

  it('GET /health/ready returns ok or degraded when Redis is optional locally', async () => {
    await smokeFetch('/health/ready', { expectStatus: [200, 503] });
  });
});
