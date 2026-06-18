import Stripe from 'stripe';
import { env } from '@/shared/config/env.config.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/** Pinned Stripe API version — bump deliberately and verify against Stripe's changelog. */
const STRIPE_API_VERSION = '2026-05-27.dahlia';
/** SDK-level network retries for Stripe calls (mutations additionally pass an idempotency key). */
const STRIPE_MAX_NETWORK_RETRIES = 2;

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
 *
 * @remarks
 * The client is cached for the process lifetime. Rotating `STRIPE_SECRET_KEY` therefore
 * requires a process restart (a deliberate design choice — runtime key swaps are rare and
 * a restart is the safe rollout path); {@link resetStripeClientForTests} exists only to
 * reset the singleton between Vitest cases.
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
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    timeout: env.STRIPE_HTTP_TIMEOUT_MS,
    ...optionalOutboundHttpClientForContractTests,
  });
  // Logged on first instantiation (lazy) rather than at module load, so importing this
  // module in a worker that never touches Stripe emits no noise.
  logger.info('Stripe client initialized');

  return stripeInstance;
}

/**
 * Test-only reset of the cached Stripe singleton so a Vitest case can re-instantiate the
 * client with different env (e.g. toggling the contract-test fetch HTTP client). Never call
 * this from runtime code — production key rotation is handled by a process restart.
 */
export function resetStripeClientForTests(): void {
  stripeInstance = null;
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
  idempotencyKey?: string;
}): Promise<Stripe.Customer> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId: options.requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        // A deterministic idempotency key prevents a retried subscription-create (which mints the
        // customer when the org has none) from creating a SECOND Stripe customer if a prior
        // attempt created the customer in Stripe but died before the local org row committed.
        return stripe.customers.create(
          omitUndefined({
            email: options.email,
            name: options.name,
            metadata: options.metadata,
          }),
          options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
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
      // sec-Q5 + sec-re-15: the BullMQ webhook worker calls this per attempt.
      // Under Stripe latency or a regional outage, every retry of every queued
      // event piled a new outbound call onto an already-stressed Stripe API.
      // Stripe's RequestOptions are the only place we can actually bind the
      // retrieve to a single attempt and a per-request timeout — the SDK does
      // not thread our AbortSignal into the underlying HTTP call, so the prior
      // `enforceAbortTimeout: true` combined with the client-level
      // `maxNetworkRetries: 2` meant ONE worker attempt could still take up to
      // 3 × STRIPE_HTTP_TIMEOUT_MS, in direct contradiction of the comment.
      // Overriding both at the call site caps the bad-day contribution at the
      // configured outbound-call window for real.
      enforceAbortTimeout: true,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        return stripe.events.retrieve(stripeEventId, undefined, {
          timeout: env.STRIPE_HTTP_TIMEOUT_MS,
          maxNetworkRetries: 0,
        });
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
  options?: { requestId?: string; idempotencyKey?: string },
): Promise<Stripe.Subscription> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId: options?.requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        if (cancelAtPeriodEnd) {
          return stripe.subscriptions.update(
            subscriptionId,
            {
              cancel_at_period_end: true,
            },
            options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
          );
        }
        return stripe.subscriptions.cancel(
          subscriptionId,
          {},
          options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
        );
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
  options?: { requestId?: string; idempotencyKey?: string },
): Promise<Stripe.Subscription> {
  return outboundCall(
    buildOutboundCallOptions({
      name: 'stripe',
      requestId: options?.requestId,
      enforceAbortTimeout: false,
      rethrowIf: (error) => error instanceof Stripe.errors.StripeError,
      operation: async () => {
        const stripe = getStripeClient();
        return stripe.subscriptions.update(
          subscriptionId,
          {
            cancel_at_period_end: false,
          },
          options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
        );
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
    idempotencyKey?: string;
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

        return stripe.subscriptions.update(
          subscriptionId,
          params,
          options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
        );
      },
    }),
  );
}

// ── Webhook verification ──────────────────────────────────────

/**
 * Verifies the `Stripe-Signature` header against the raw body and returns the parsed
 * `Stripe.Event`. Throws when the secret is missing or no configured secret matches.
 *
 * @remarks
 * **Tolerance:** configurable via `STRIPE_WEBHOOK_TOLERANCE_SECONDS` (default 150 — half of
 * Stripe's 300 s default — to halve the replay window; legitimate deliveries arrive within
 * seconds of signing). Operators can widen it (up to 1800 s) to accept deliveries that arrive
 * late after an API outage longer than the window, since Stripe retries carry the original
 * signing timestamp.
 *
 * **Key rotation (sec-new-B3):** `STRIPE_WEBHOOK_SECRET` may be a comma-separated list of
 * `whsec_`-prefixed secrets (e.g. `whsec_old,whsec_new`). Each segment is trimmed; empty
 * segments from trailing commas are ignored. Secrets are tried in order and the first that
 * verifies is returned. This enables zero-downtime key rotation: add the new secret to the
 * list in the Stripe Dashboard, then remove the old one once it is no longer in use. If no
 * secret matches, the last `StripeSignatureVerificationError` is re-thrown so callers can
 * distinguish "bad signature" from "missing config".
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
  // sec-new-B3: split on comma so operators can list old + new secret during a
  // rolling key rotation without dropping in-flight deliveries.
  const secrets = webhookSecret
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let lastError: unknown;
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(
        body,
        signature,
        secret,
        env.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
