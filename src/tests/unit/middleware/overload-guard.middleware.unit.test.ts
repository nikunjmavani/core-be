import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import overloadGuardMiddleware, {
  shouldShedRequest,
} from '@/shared/middlewares/core/overload-guard.middleware.js';

describe('overload-guard.middleware', () => {
  describe('shouldShedRequest', () => {
    it('never sheds allowlisted health/metrics paths, even far over threshold', () => {
      for (const path of ['/livez', '/readyz', '/metrics']) {
        expect(shouldShedRequest({ path, recentEventLoopDelayMs: 9_999, thresholdMs: 250 })).toBe(
          false,
        );
      }
    });

    it('does not shed when recent delay is below threshold', () => {
      expect(
        shouldShedRequest({
          path: '/api/v1/users/me',
          recentEventLoopDelayMs: 40,
          thresholdMs: 250,
        }),
      ).toBe(false);
    });

    it('sheds when recent delay reaches or exceeds the threshold', () => {
      expect(
        shouldShedRequest({
          path: '/api/v1/users/me',
          recentEventLoopDelayMs: 250,
          thresholdMs: 250,
        }),
      ).toBe(true);
      expect(
        shouldShedRequest({
          path: '/api/v1/users/me',
          recentEventLoopDelayMs: 600,
          thresholdMs: 250,
        }),
      ).toBe(true);
    });
  });

  describe('plugin', () => {
    it('passes requests through when the event loop is not stalled (dormant)', async () => {
      const app = Fastify();
      await app.register(overloadGuardMiddleware);
      app.get('/x', async () => ({ ok: true }));
      const response = await app.inject({ method: 'GET', url: '/x' });
      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });
});
