import Stripe from 'stripe';
import { env } from '@/shared/config/env.config.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

let stripeInstance: Stripe | null = null;

/**
 * Nock 14 intercepts `fetch` (undici) reliably; Stripe's default `NodeHttpClient` +
 * deferred `socket` handling can hang under nock 14 / `@mswjs/interceptors` (see stripe-node#2211,
 * nock#2785). Contract tests run with `CONTRACT_TESTS_ONLY=true`; use the fetch-based client only
 * there so production keeps the Node HTTP stack.
 */
function shouldUseStripeFetchHttpClientForContractOutboundTests(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.CONTRACT_TESTS_ONLY === 'true';
}

/**
 * Get the singleton Stripe client instance.
 * Throws if STRIPE_SECRET_KEY is not configured.
 */
export function getStripeClient(): Stripe {
  if (stripeInstance) return stripeInstance;

  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  const optionalOutboundHttpClientForContractTests =
    shouldUseStripeFetchHttpClientForContractOutboundTests()
      ? {
          httpClient: Stripe.createFetchHttpClient((...arguments_: Parameters<typeof fetch>) =>
            fetch(...arguments_),
          ),
        }
      : {};

  stripeInstance = new Stripe(secretKey, {
    typescript: true,
    maxNetworkRetries: 2,
    timeout: env.STRIPE_HTTP_TIMEOUT_MS,
    ...optionalOutboundHttpClientForContractTests,
  });

  return stripeInstance;
}

/**
 * Check if Stripe is configured and ready.
 */
export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** True when HTTP Stripe webhook ingress can verify signatures. */
export function isStripeWebhookIngressConfigured(): boolean {
  return Boolean(env.STRIPE_WEBHOOK_SECRET);
}

// ── Customer helpers ──────────────────────────────────────────

/**
 * Creates a Stripe customer via `customers.create`. Wrapped in {@link outboundCall} for
 * the shared circuit breaker, timeout, and error classification; `Stripe.errors.StripeError`
 * is rethrown unwrapped so domain code can branch on Stripe-specific codes.
 */
export async function createStripeCustomer(options: {
  email: string;
  name: string;
  metadata?: Record<string, string>;
  requestId?: string;
}): Promise<Stripe.Customer> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId: options.requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        return stripe.customers.create(
          omitUndefined({
            email: options.email,
            name: options.name,
            metadata: options.metadata,
          }),
        );
      },
    }),
  );
}

/**
 * Retrieves a Stripe customer by id. Returns `null` for both deleted customers and
 * `resource_missing` lookups so callers do not need to special-case 404s; other Stripe
 * errors propagate unwrapped.
 */
export async function getStripeCustomer(
  customerId: string,
  requestId?: string,
): Promise<Stripe.Customer | null> {
  const stripe = getStripeClient();
  try {
    return await outboundCall(
      buildOutboundCallOptions({
        name: 'stripe',
        requestId,
        enforceAbortTimeout: false,
        rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
        operation: async () => {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer.deleted) return null;
          return customer as Stripe.Customer;
        },
      }),
    );
  } catch (error) {
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError &&
      error.code === 'resource_missing'
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetches a fully-formed Stripe event by id — used by the webhook reclaim worker to
 * re-process events whose payloads are missing from the local ledger.
 */
export async function retrieveStripeEvent(
  stripeEventId: string,
  requestId?: string,
): Promise<Stripe.Event> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        return stripe.events.retrieve(stripeEventId);
      },
    }),
  );
}

// ── Subscription helpers ──────────────────────────────────────

/**
 * Creates a Stripe subscription in `default_incomplete` payment behaviour so the
 * platform can confirm the first PaymentIntent client-side before activation. Passes a
 * Stripe-native idempotency key when provided to make retries safe across HTTP attempts.
 */
export async function createStripeSubscription(options: {
  customerId: string;
  priceId: string;
  trialEnd?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
}): Promise<Stripe.Subscription> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId: options.requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        return stripe.subscriptions.create(
          omitUndefined({
            customer: options.customerId,
            items: [{ price: options.priceId }],
            trial_end: options.trialEnd,
            metadata: options.metadata,
            payment_behavior: 'default_incomplete' as const,
          }),
          options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
        );
      },
    }),
  );
}

/**
 * Cancels a Stripe subscription. By default schedules cancellation at the end of the
 * current billing period (`cancel_at_period_end: true`); pass `false` to cancel
 * immediately and stop further proration.
 */
export async function cancelStripeSubscription(
  subscriptionId: string,
  cancelAtPeriodEnd = true,
  requestId?: string,
): Promise<Stripe.Subscription> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        if (cancelAtPeriodEnd) {
          return stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
          });
        }
        return stripe.subscriptions.cancel(subscriptionId);
      },
    }),
  );
}

/**
 * Reverses a pending period-end cancellation by clearing `cancel_at_period_end`. No-op
 * on Stripe's side if the subscription was never scheduled to cancel.
 */
export async function resumeStripeSubscription(
  subscriptionId: string,
  requestId?: string,
): Promise<Stripe.Subscription> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        return stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: false,
        });
      },
    }),
  );
}

/**
 * Updates a Stripe subscription's price and/or metadata. When `priceId` is set the
 * current subscription item is retrieved first so the swap targets the existing line
 * item (avoids creating a second item alongside the original).
 */
export async function updateStripeSubscription(
  subscriptionId: string,
  options: {
    priceId?: string;
    metadata?: Record<string, string>;
    requestId?: string;
  },
): Promise<Stripe.Subscription> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId: options.requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        const params: Stripe.SubscriptionUpdateParams = {};

        if (options.priceId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const itemId = subscription.items.data[0]?.id;
          if (itemId) {
            params.items = [{ id: itemId, price: options.priceId }];
          }
        }

        if (options.metadata) {
          params.metadata = options.metadata;
        }

        return stripe.subscriptions.update(subscriptionId, params);
      },
    }),
  );
}

// ── Webhook verification ──────────────────────────────────────

/**
 * Verifies the `Stripe-Signature` header against the raw body using `STRIPE_WEBHOOK_SECRET`
 * and returns the parsed `Stripe.Event`. Throws when the secret is missing or the
 * signature does not match — callers must use the raw (un-parsed) request body.
 */
export function constructStripeWebhookEvent(
  body: string | Buffer,
  signature: string,
): Stripe.Event {
  const stripe = getStripeClient();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}

logger.info('Stripe client module loaded');
