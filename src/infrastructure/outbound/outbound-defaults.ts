import { env } from '@/shared/config/env.config.js';
import {
  resendCircuit,
  s3Circuit,
  stripeCircuit,
  turnstileCircuit,
  type CircuitBreaker,
} from '@/infrastructure/resilience/circuit-breaker.js';

/**
 * Closed set of external integrations that {@link outboundCall} understands. Adding a
 * new value here requires a matching entry in `OUTBOUND_DEFAULT_FACTORIES` (timeout +
 * optional circuit) so timeouts and breaker wiring stay consistent across call sites.
 */
export type OutboundIntegrationName =
  | 'stripe'
  | 's3'
  | 'resend'
  | 'webhook'
  | 'webhook-test'
  | 'oauth-google'
  | 'oauth-github'
  | 'captcha-turnstile';

/** Per-integration defaults (HTTP timeout + circuit breaker) applied when call sites omit overrides. */
export interface OutboundIntegrationDefaults {
  timeoutMs: number;
  circuit?: CircuitBreaker;
}

const OAUTH_HTTP_TIMEOUT_MS = 10_000;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 30_000;
const WEBHOOK_TEST_TIMEOUT_MS = 10_000;
const TURNSTILE_HTTP_TIMEOUT_MS = 5_000;
/** Wall-clock cap for S3 SDK calls (SDK also uses maxAttempts). */
const S3_HTTP_TIMEOUT_MS = 30_000;

type OutboundDefaultsFactory = () => OutboundIntegrationDefaults;

const OUTBOUND_DEFAULT_FACTORIES: Record<OutboundIntegrationName, OutboundDefaultsFactory> = {
  stripe: () => ({
    timeoutMs: env.STRIPE_HTTP_TIMEOUT_MS,
    circuit: stripeCircuit,
  }),
  s3: () => ({
    timeoutMs: S3_HTTP_TIMEOUT_MS,
    circuit: s3Circuit,
  }),
  resend: () => ({
    timeoutMs: env.RESEND_HTTP_TIMEOUT_MS,
    circuit: resendCircuit,
  }),
  webhook: () => ({
    timeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
  }),
  'webhook-test': () => ({
    timeoutMs: WEBHOOK_TEST_TIMEOUT_MS,
  }),
  'oauth-google': () => ({
    timeoutMs: OAUTH_HTTP_TIMEOUT_MS,
  }),
  'oauth-github': () => ({
    timeoutMs: OAUTH_HTTP_TIMEOUT_MS,
  }),
  'captcha-turnstile': () => ({
    timeoutMs: TURNSTILE_HTTP_TIMEOUT_MS,
    circuit: turnstileCircuit,
  }),
};

/**
 * Returns timeout + circuit-breaker defaults for the given integration. Evaluated lazily
 * via factory functions so changes to env-derived values (e.g. `STRIPE_HTTP_TIMEOUT_MS`)
 * after boot are still picked up if process env is mutated under tests.
 */
export function resolveOutboundDefaults(
  name: OutboundIntegrationName,
): OutboundIntegrationDefaults {
  return OUTBOUND_DEFAULT_FACTORIES[name]();
}
