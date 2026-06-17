`src/domains/billing/sub-domains/subscription/`

# Subscription

Parent: [billing](../../OVERVIEW.md)

## Purpose

The organization's active subscription record. One row per organization, bound to a Stripe customer and Stripe subscription. State changes always flow Stripe webhook → service → DB → emit event; we never write subscription state to DB without a Stripe-confirmed event behind it.

## Key invariants

- **One subscription per organization**: enforced at the service layer; concurrent create attempts resolve to a single Stripe subscription via the forwarded idempotency key.
- **State changes are Stripe-driven**: `subscriptions.status` only transitions in response to a webhook event whose `event.created_at` is newer than the row's last update.
- **Stale-event rejection**: out-of-order webhooks are rejected so state cannot roll backward.
- **Network I/O outside RLS contexts**: Stripe API calls run **outside** `withOrganizationDatabaseContext`. The service interleaves: `withOrganizationDatabaseContext(read)` → Stripe call → `withOrganizationDatabaseContext(write)`.
- **Immutable ledger semantics**: subscription rows do not soft-delete. Cancellation transitions to `canceled`; the row stays for forensic + invoice-history value.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> trialing: created with trial
  [*] --> active: created without trial
  trialing --> active: trial ends, payment succeeds
  active --> past_due: invoice.payment_failed
  past_due --> active: invoice.paid
  past_due --> canceled: Stripe gives up dunning
  active --> canceled: customer cancels
  canceled --> [*]
```

## Events

- Emits: `BILLING_EVENT.SUBSCRIPTION_CREATED`, `_UPDATED`, `_PAST_DUE`, `_ACTIVE`, `_CANCELED`. Listeners under [notify/events/](src/domains/notify/events/) translate these into in-app notifications + outbound webhook deliveries + email.

## External integrations

- **Stripe** — wrapped by [src/infrastructure/payment/stripe.client.ts](src/infrastructure/payment/stripe.client.ts) with circuit breaker + Sentry instrumentation.

## Failure modes

- **Stripe API failure on a user-initiated mutation (`create` / `cancel` / `resume`)** → the provider adapter is **fail-closed**: it logs and throws `ServiceUnavailableError` (503, `errors:paymentProviderUnavailable`) *before* any local write, so subscription state in DB is unchanged (no row created, no `cancel_at_period_end` / `status` flip). The Stripe webhook reconciles once Stripe recovers.
- **Stripe `Idempotency-Key` reuse with different payload** → Stripe returns 400; we surface as 400 to the client.
- **Webhook event timestamp older than the row** → service rejects the change (logs at info), Stripe retry will eventually pass with the latest event.

## Policy constants

- `IDEMPOTENCY_RESPONSE_CACHE_TTL_SECONDS = 86 400`
