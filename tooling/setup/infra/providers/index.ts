/**
 * Infra provider registry.
 *
 * The orchestrator iterates this ordered array — every third-party provider
 * exposes the same `InfraProvider` interface, so each one performs its actions
 * one by one with the same interaction flow (explain → execute → verify →
 * recover) and the same hooks for preview, settings-review, existence-check,
 * health-check, and manual deletion instructions.
 *
 * To add a new third party:
 *   1. Create `providers/setup-<name>/setup-<name>.provider.ts`
 *   2. Export `setup<Name>Provider: InfraProvider`
 *   3. Add it to `INFRA_PROVIDERS` below (order matters — providers run sequentially)
 */
import type { InfraProvider } from '../../common/types.js';
import { setupNeonProvider } from './setup-neon/setup-neon.provider.js';
import { setupAwsProvider } from './setup-aws/setup-aws.provider.js';
import { setupSentryProvider } from './setup-sentry/setup-sentry.provider.js';
import { setupJwtProvider } from './setup-jwt/setup-jwt.provider.js';
import { setupResendProvider } from './setup-resend/setup-resend.provider.js';
import { setupStripeProvider } from './setup-stripe/setup-stripe.provider.js';
import { setupOauthProvider } from './setup-oauth/setup-oauth.provider.js';
import { setupRailwayProvider } from './setup-railway/setup-railway.provider.js';
import { setupRailwayRedisProvider } from './setup-railway-redis/setup-railway-redis.provider.js';
import { setupGithubProvider } from './setup-github/setup-github.provider.js';
import { setupPostmanProvider } from './setup-postman/setup-postman.provider.js';

export const INFRA_PROVIDERS: readonly InfraProvider[] = [
  setupNeonProvider,
  setupAwsProvider,
  setupSentryProvider,
  setupJwtProvider,
  setupResendProvider,
  setupStripeProvider,
  setupOauthProvider,
  setupRailwayProvider,
  setupRailwayRedisProvider,
  setupGithubProvider,
  setupPostmanProvider,
] as const;

export function getProvider(key: string): InfraProvider | undefined {
  return INFRA_PROVIDERS.find((provider) => provider.key === key);
}
