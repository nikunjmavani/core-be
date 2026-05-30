import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  Sentry: { addBreadcrumb: vi.fn() },
}));

describe('rate-limit-presets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('STRICT_PUBLIC_RATE_LIMIT allows 5000 req/min in test NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { STRICT_PUBLIC_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_RATE_LIMIT.config.rateLimit.max).toBe(5000);
  });

  it('STRICT_PUBLIC_RATE_LIMIT caps public auth routes at 5 req/min outside test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_RATE_LIMIT.config.rateLimit.max).toBe(5);
    expect(STRICT_PUBLIC_RATE_LIMIT.config.rateLimit.timeWindow).toBe(60_000);
  });

  it('STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS caps per email at 5 / 15 min on preHandler outside test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.max).toBe(5);
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.timeWindow).toBe(15 * 60_000);
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.hook).toBe('preHandler');
  });

  it('STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS lifts the cap under test NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    expect(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.max).toBe(5000);
  });

  it('per-email key generator normalizes the body email (trim + lowercase) and ignores IP', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    const keyGenerator = STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.keyGenerator;
    expect(keyGenerator).toBeDefined();
    const key = await keyGenerator?.({
      ip: '203.0.113.7',
      body: { email: '  USER@Example.COM ' },
    } as never);
    expect(key).toBe('email:user@example.com');
  });

  it('per-email key generator falls back to IP when the body has no usable email', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    const keyGenerator = STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS.keyGenerator;
    const key = await keyGenerator?.({ ip: '203.0.113.7', body: {} } as never);
    expect(key).toBe('ip:203.0.113.7');
  });

  it('org-scoped key namespaces the organization by actor so victim buckets are isolated (audit #14)', async () => {
    const { ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    const keyGenerator = ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config.rateLimit.keyGenerator;
    expect(keyGenerator).toBeDefined();

    // An attacker and a real member hitting the SAME victim org resolve to DIFFERENT buckets,
    // so the attacker can never drain the member's quota.
    const attackerKey = await keyGenerator?.({
      ip: '203.0.113.7',
      organizationId: 'victim-org',
      auth: { userId: 'attacker-user' },
    } as never);
    const memberKey = await keyGenerator?.({
      ip: '198.51.100.4',
      organizationId: 'victim-org',
      auth: { userId: 'member-user' },
    } as never);

    expect(attackerKey).toBe('organization:victim-org:actor:attacker-user');
    expect(memberKey).toBe('organization:victim-org:actor:member-user');
    expect(attackerKey).not.toBe(memberKey);
  });

  it('org-scoped key namespaces API-key actors and falls back to actor, then IP', async () => {
    const { ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT } = await import(
      '@/shared/middlewares/rate-limit-presets.constants.js'
    );
    const keyGenerator = ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT.config.rateLimit.keyGenerator;

    const apiKeyActor = await keyGenerator?.({
      ip: '203.0.113.7',
      organizationId: 'org-1',
      auth: { apiKeyPublicId: 'apikey-1' },
    } as never);
    expect(apiKeyActor).toBe('organization:org-1:actor:apikey-1');

    const noOrgContext = await keyGenerator?.({
      ip: '203.0.113.7',
      auth: { userId: 'user-1' },
    } as never);
    expect(noOrgContext).toBe('actor:user-1');

    const unauthenticated = await keyGenerator?.({ ip: '203.0.113.7', auth: undefined } as never);
    expect(unauthenticated).toBe('ip:203.0.113.7');
  });
});
