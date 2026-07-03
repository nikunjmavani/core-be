import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import overloadGuardMiddleware, {
  shouldShedRequest,
} from '@/shared/middlewares/core/overload-guard.middleware.js';

/** Baseline options that do NOT shed — individual tests override one signal at a time. */
const baseShedOptions = {
  path: '/api/v1/users/me',
  recentEventLoopDelayMs: 40,
  thresholdMs: 250,
  activeDbCheckouts: 0,
  dbCheckoutShedThreshold: 18, // ceil(20 * 0.9)
};

describe('overload-guard.middleware', () => {
  describe('shouldShedRequest', () => {
    it('never sheds allowlisted health/metrics paths, even far over both thresholds', () => {
      for (const path of ['/livez', '/readyz', '/metrics']) {
        expect(
          shouldShedRequest({
            ...baseShedOptions,
            path,
            recentEventLoopDelayMs: 9_999,
            activeDbCheckouts: 20,
          }),
        ).toBe(false);
      }
    });

    it('does not shed when both signals are below threshold', () => {
      expect(shouldShedRequest(baseShedOptions)).toBe(false);
    });

    it('sheds when recent event-loop delay reaches or exceeds the threshold', () => {
      expect(shouldShedRequest({ ...baseShedOptions, recentEventLoopDelayMs: 250 })).toBe(true);
      expect(shouldShedRequest({ ...baseShedOptions, recentEventLoopDelayMs: 600 })).toBe(true);
    });

    it('sheds on DB-pool saturation even when the event loop is idle', () => {
      // Event loop well below threshold, but the pool is at/over the shed line.
      expect(
        shouldShedRequest({ ...baseShedOptions, recentEventLoopDelayMs: 5, activeDbCheckouts: 18 }),
      ).toBe(true);
      expect(
        shouldShedRequest({ ...baseShedOptions, recentEventLoopDelayMs: 5, activeDbCheckouts: 20 }),
      ).toBe(true);
    });

    it('does not shed when checkouts are below the pool shed threshold', () => {
      expect(shouldShedRequest({ ...baseShedOptions, activeDbCheckouts: 17 })).toBe(false);
    });

    it('disables pool-saturation shedding when the threshold is 0 (ratio disabled)', () => {
      expect(
        shouldShedRequest({
          ...baseShedOptions,
          activeDbCheckouts: 9_999,
          dbCheckoutShedThreshold: 0,
        }),
      ).toBe(false);
    });
  });

  describe('plugin', () => {
    it('passes requests through when neither signal is saturated (dormant)', async () => {
      const app = Fastify();
      await app.register(overloadGuardMiddleware);
      app.get('/x', async () => ({ ok: true }));
      const response = await app.inject({ method: 'GET', url: '/x' });
      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });
});
