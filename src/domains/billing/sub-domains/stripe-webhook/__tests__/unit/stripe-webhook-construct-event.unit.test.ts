import Stripe from 'stripe';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression suite for sec-new-B3: zero-downtime Stripe webhook secret rotation.
 *
 * `constructStripeWebhookEvent` was a single-secret wrapper around
 * `stripe.webhooks.constructEvent`. Operators cannot swap STRIPE_WEBHOOK_SECRET
 * atomically — the Stripe Dashboard starts sending events signed with the new
 * secret before the old one is retired, causing a signature-verification outage
 * of up to 3 days (Stripe's retry window).
 *
 * The fix accepts a comma-separated list of `whsec_`-prefixed secrets: secrets
 * are tried in order and the first that verifies is returned. This allows
 * operators to list both old and new secrets during a rolling rotation. These
 * tests use `Stripe.webhooks.generateTestHeaderString` to mint real HMAC
 * signatures — they verify the security property itself, not just loop plumbing.
 */

// ── Env + Stripe client mocking ─────────────────────────────────────────────

const SK_TEST = 'sk_test_00000000000000000000000000000000000000000000000000';

// Two independent Stripe `whsec_*` shaped secrets used throughout.
const SECRET_A = 'whsec_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'whsec_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SECRET_C = 'whsec_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

let mockWebhookSecret: string | undefined = SECRET_A;

vi.mock('@/shared/config/env.config.js', () => {
  const envProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'STRIPE_SECRET_KEY') return SK_TEST;
      if (prop === 'STRIPE_WEBHOOK_SECRET') return mockWebhookSecret;
      if (prop === 'STRIPE_HTTP_TIMEOUT_MS') return 10_000;
      return undefined;
    },
  });
  return {
    env: envProxy,
    getEnv: () => envProxy,
    resetEnvCacheForTests: vi.fn(),
  };
});

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAYLOAD = JSON.stringify({ id: 'evt_test_001', type: 'customer.created' });

/**
 * Mint a real Stripe-Signature header for `PAYLOAD` signed with the given secret.
 * `generateTestHeaderString` is the canonical SDK utility for this purpose.
 */
function signPayload(secret: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: PAYLOAD, secret });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('constructStripeWebhookEvent — key rotation (sec-new-B3)', () => {
  beforeEach(() => {
    mockWebhookSecret = SECRET_A;
    // Force the Stripe singleton to reset between tests so the mock env is picked up.
    vi.resetModules();
  });

  it('verifies a payload signed with the only configured secret (single-secret baseline)', async () => {
    mockWebhookSecret = SECRET_A;
    const { constructStripeWebhookEvent } = await import(
      '@/infrastructure/payment/stripe.client.js'
    );
    const sig = signPayload(SECRET_A);
    const event = constructStripeWebhookEvent(Buffer.from(PAYLOAD), sig);
    expect(event.id).toBe('evt_test_001');
  });

  it('sec-new-B3: verifies a payload signed with the FIRST secret in a two-secret list', async () => {
    mockWebhookSecret = `${SECRET_A},${SECRET_B}`;
    const { constructStripeWebhookEvent } = await import(
      '@/infrastructure/payment/stripe.client.js'
    );
    const sig = signPayload(SECRET_A);
    const event = constructStripeWebhookEvent(Buffer.from(PAYLOAD), sig);
    expect(event.id).toBe('evt_test_001');
  });

  it('sec-new-B3: verifies a payload signed with the SECOND secret (new key after rotation)', async () => {
    mockWebhookSecret = `${SECRET_A},${SECRET_B}`;
    const { constructStripeWebhookEvent } = await import(
      '@/infrastructure/payment/stripe.client.js'
    );
    // Stripe Dashboard has already rotated to SECRET_B; SECRET_A is still in the list.
    const sig = signPayload(SECRET_B);
    const event = constructStripeWebhookEvent(Buffer.from(PAYLOAD), sig);
    expect(event.id).toBe('evt_test_001');
  });

  it('sec-new-B3: rejects a payload signed with an unconfigured secret (C not in A,B list)', async () => {
    mockWebhookSecret = `${SECRET_A},${SECRET_B}`;
    const { constructStripeWebhookEvent } = await import(
      '@/infrastructure/payment/stripe.client.js'
    );
    const sig = signPayload(SECRET_C);
    expect(() => constructStripeWebhookEvent(Buffer.from(PAYLOAD), sig)).toThrow();
  });

  it('sec-new-B3: ignores whitespace and trailing commas in the secret list', async () => {
    // Operators copy-paste from the Stripe Dashboard and may introduce spaces or trailing commas.
    mockWebhookSecret = `  ${SECRET_A}  ,  ${SECRET_B}  ,  `;
    const { constructStripeWebhookEvent } = await import(
      '@/infrastructure/payment/stripe.client.js'
    );
    const sigA = signPayload(SECRET_A);
    const sigB = signPayload(SECRET_B);
    expect(constructStripeWebhookEvent(Buffer.from(PAYLOAD), sigA).id).toBe('evt_test_001');
    expect(constructStripeWebhookEvent(Buffer.from(PAYLOAD), sigB).id).toBe('evt_test_001');
  });

  it('throws "not configured" when STRIPE_WEBHOOK_SECRET is absent', async () => {
    mockWebhookSecret = undefined;
    const { constructStripeWebhookEvent } = await import(
      '@/infrastructure/payment/stripe.client.js'
    );
    expect(() => constructStripeWebhookEvent(Buffer.from(PAYLOAD), 'sig')).toThrow(
      'STRIPE_WEBHOOK_SECRET is not configured',
    );
  });
});
