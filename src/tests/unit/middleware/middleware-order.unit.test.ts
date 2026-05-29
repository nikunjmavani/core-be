import { describe, expect, it } from 'vitest';
import { middlewarePlugins } from '@/shared/middlewares/index.js';
import tenantMiddleware from '@/shared/middlewares/tenant.middleware.js';
import rateLimitMiddleware from '@/shared/middlewares/rate-limit.middleware.js';
import organizationRlsTransactionMiddleware from '@/shared/middlewares/organization-rls-transaction.middleware.js';
import i18nMiddleware from '@/shared/middlewares/i18n.middleware.js';

/**
 * Regression test for middleware ordering. The global limiter is keyed strictly on
 * `request.ip`, so it no longer depends on tenant resolution; the load-bearing constraint
 * is that rate limiting runs before the per-request RLS transaction so throttled requests
 * never open a DB connection. i18n must precede tenant so its translated errors render.
 */
describe('middleware registration order', () => {
  const order = middlewarePlugins as readonly unknown[];

  it('rate limits before opening the per-request RLS transaction', () => {
    const rateLimitIndex = order.indexOf(rateLimitMiddleware);
    const rlsIndex = order.indexOf(organizationRlsTransactionMiddleware);

    expect(rateLimitIndex).toBeGreaterThanOrEqual(0);
    expect(rlsIndex).toBeGreaterThanOrEqual(0);
    expect(rateLimitIndex).toBeLessThan(rlsIndex);
  });

  it('resolves tenant after i18n so its translated errors can be rendered', () => {
    const i18nIndex = order.indexOf(i18nMiddleware);
    const tenantIndex = order.indexOf(tenantMiddleware);

    expect(i18nIndex).toBeGreaterThanOrEqual(0);
    expect(tenantIndex).toBeGreaterThanOrEqual(0);
    expect(i18nIndex).toBeLessThan(tenantIndex);
  });
});
