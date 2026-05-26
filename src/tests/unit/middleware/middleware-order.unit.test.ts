import { describe, expect, it } from 'vitest';
import { middlewarePlugins } from '@/shared/middlewares/index.js';
import tenantMiddleware from '@/shared/middlewares/tenant.middleware.js';
import rateLimitMiddleware from '@/shared/middlewares/rate-limit.middleware.js';
import organizationRlsTransactionMiddleware from '@/shared/middlewares/organization-rls-transaction.middleware.js';
import i18nMiddleware from '@/shared/middlewares/i18n.middleware.js';

/**
 * Regression test for production hardening item #3 — global org rate limiting must run
 * after tenant resolution. The rate-limit keyGenerator/max read `request.organizationId`
 * in the onRequest phase; if rate limiting is registered before tenant middleware, that
 * value is still null and org-scoped limits silently degrade to per-IP keys.
 */
describe('middleware registration order', () => {
  const order = middlewarePlugins as readonly unknown[];

  it('registers tenant middleware before rate limiting', () => {
    const tenantIndex = order.indexOf(tenantMiddleware);
    const rateLimitIndex = order.indexOf(rateLimitMiddleware);

    expect(tenantIndex).toBeGreaterThanOrEqual(0);
    expect(rateLimitIndex).toBeGreaterThanOrEqual(0);
    expect(tenantIndex).toBeLessThan(rateLimitIndex);
  });

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
