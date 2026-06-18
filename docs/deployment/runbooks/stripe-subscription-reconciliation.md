# Stripe subscription changePlan / cancel reconciliation

How **API-initiated** subscription changes relate to **Stripe webhooks** and local database state. For webhook ingress and idempotency, see `src/domains/billing/sub-domains/stripe-webhook/`.

---

## changePlan (plan / price change)

| Step | System | Behavior |
| ---- | ------ | -------- |
| 1 | API `changePlan` | Updates Stripe subscription price when `STRIPE_SECRET_KEY` is set and the plan has a Stripe price id |
| 2 | API | Updates local `billing.subscriptions` (`plan_id`, period fields) |
| 3 | Stripe | Emits `customer.subscription.updated` (at-least-once) |
| 4 | Webhook worker | `StripeWebhookService` syncs status/period from the event via `syncFromStripeProviderSubscription` |

**Reconciliation window:** Treat Stripe as source of truth for provider-linked subscriptions within **minutes** of the API call. Until `customer.subscription.updated` is processed, local plan/period may lead Stripe briefly if step 2 succeeded and step 3 is delayed. The webhook path uses `stripe_created_at` ordering to ignore stale events.

**Compensation:** If local DB update fails after Stripe was updated, `changePlan` attempts to revert the Stripe price to the previous plan price (see `subscription.service.ts`).

**Stripe failures:** If the Stripe update throws or no price id exists, the service logs and still attempts the local update (documented in unit tests).

---

## cancel (cancel at period end)

| Step | System | Behavior |
| ---- | ------ | -------- |
| 1 | API `cancel` | Calls Stripe `cancel_at_period_end` when a provider subscription id exists |
| 2 | API | Sets local `cancel_at_period_end: true` |
| 3 | Stripe | Eventually sends `customer.subscription.updated` / `customer.subscription.deleted` |
| 4 | Webhook worker | Syncs canceled status and period end |

**Reconciliation window:** Local `cancel_at_period_end` is immediate; final **status** (`CANCELED`) and period boundaries may arrive via webhook **seconds to minutes** later. Do not assume the subscription is fully canceled in Stripe until the webhook ledger row is `processed` or Stripe dashboard confirms.

**Stripe failures:** Stripe cancel errors are logged; local `cancel_at_period_end` is still set so the product UX is not blocked solely by provider errors.

---

## Operational checks

1. **Webhook lag:** Inspect `billing.stripe_webhook_events` (`processing_status`, `request_id` from correlation id) for stuck `processing` rows.
2. **Drift:** Compare local subscription `status` / `provider_subscription_id` with Stripe dashboard when users report billing mismatches after changePlan/cancel.
3. **Duplicate events:** Re-delivered webhooks are idempotent (`tryClaimEvent` + `onConflictDoNothing`).
4. **Signature tolerance after an outage:** webhook signatures are accepted within `STRIPE_WEBHOOK_TOLERANCE_SECONDS` of the event's signing time (default **150s**, half of Stripe's 300s default, to keep the replay window tight). Stripe retries carry the **original** signing timestamp, so if the API is unreachable longer than the tolerance, every retry for that event is rejected once it ages past the window. To recover deliveries after a prolonged outage, temporarily raise `STRIPE_WEBHOOK_TOLERANCE_SECONDS` (up to **1800s**) so in-flight retries verify, then restore the default. Events that did reach the API are still recovered by the local-ledger reclaim worker regardless of this knob.

---

## Related

- [data-lifecycle-deletion.md](../../reference/data/data-lifecycle-deletion.md) — subscriptions are an immutable ledger (no `deleted_at`)
- [observability.md](observability.md) — Sentry + logs for `stripe.subscription.*` failures
- [cicd-and-deployment.md](../ci-cd/cicd-and-deployment.md) — `STRIPE_*` deploy secrets
- [`src/domains/billing/sub-domains/subscription/OVERVIEW.md`](../../../src/domains/billing/sub-domains/subscription/OVERVIEW.md) — subscription state machine, network-I/O-outside-RLS rule, stale-event rejection
- [`src/domains/billing/sub-domains/stripe-webhook/OVERVIEW.md`](../../../src/domains/billing/sub-domains/stripe-webhook/OVERVIEW.md) — webhook receiver, reclaim window, per-source DLQ
- [`src/FLOWS.md`](../../../src/FLOWS.md) § Stripe webhook ingest, § Subscription change — end-to-end flow diagrams
