import { describe, it } from 'vitest';
import { smokeFetch, smokeLogin } from '@/tests/smoke/helpers/smoke-client.js';

describe('Smoke: upload', () => {
  it('GET /api/v1/uploads/:upload_id answers 404 for an unknown id without 5xx', async () => {
    // A syntactically valid public id (`up_` + 21 [a-z0-9]) that cannot exist: the
    // request passes param validation and reaches the handler + repository, so a 404
    // proves the whole read path is wired in the running binary. The presign POST is
    // deliberately NOT smoked here — it needs live S3 credentials and is covered by
    // the standalone ops sweep (`pnpm test:api-smoke`) where the environment has them.
    const { accessToken } = await smokeLogin();
    await smokeFetch(`/api/v1/uploads/up_${'0'.repeat(21)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      expectStatus: 404,
    });
  });
});
