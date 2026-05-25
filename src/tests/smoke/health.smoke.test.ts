import { describe, it } from 'vitest';
import { smokeFetch } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: health', () => {
  it('GET /health returns 200', async () => {
    await smokeFetch('/health', { expectStatus: 200 });
  });

  it('GET /health returns ok or degraded when Redis is optional locally', async () => {
    await smokeFetch('/health', { expectStatus: [200, 503] });
  });
});
