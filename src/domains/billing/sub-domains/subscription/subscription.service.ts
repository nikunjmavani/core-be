import { ConflictError, NotFoundError, UnprocessableEntityError } from '@/shared/errors/index.js';

import { isPostgresUniqueViolation } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { INACTIVE_SUBSCRIPTION_STATUSES } from './subscription.repository.js';

/**
 * Subscription statuses that are considered terminal (non-mutable).
 *
 * @remarks
 * `CANCELED` and `INCOMPLETE_EXPIRED` rows can no longer be modified via the
 * cancel / resume / changePlan operations. Attempting to do so would make a
 * spurious Stripe API call against an already-inactive subscription, which
 * produces a Stripe error, surfaces as 503 to the caller, and may confuse
 * downstream event reconciliation. Guard every mutating method with this set
 * before reaching the payment provider (sec-new-B1). Sourced from
 * {@link INACTIVE_SUBSCRIPTION_STATUSES} so the "mutable" and "occupies the
 * subscription slot" definitions stay in lockstep (audit-#1).
 */
const TERMINAL_STATUSES = new Set<string>(INACTIVE_SUBSCRIPTION_STATUSES);
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import type { PaymentProvider } from './payment-provider.port.js';
import type { SubscriptionRepository } from './subscription.repository.js';
import type { SubscriptionUpdateData } from './subscription.types.js';
import {
  validateChangePlan,
  validateCreateSubscription,
  validateUpdateSubscription,
} from './subscription.validator.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';

/**
 * Coordinates plan lookups, payment-provider calls, and subscription updates
 * for a single organization.
 *
 * @remarks
 * - **Algorithm:** Each public method runs the database portion inside
 *   {@link withOrganizationDatabaseContext} so Postgres sees the org GUC for
 *   RLS, then performs the Stripe API call (create / change-plan / cancel /
 *   resume) outside that context, then re-opens an organization context to
 *   write back the resulting row. Webhook-triggered methods
 *   (`syncFromStripeProviderSubscription`, `markCanceledByStripeProviderSubscriptionId`)
 *   accept a repository override so the webhook worker can pass its own
 *   worker-scoped handle.
 * - **Failure modes:** Throws {@link NotFoundError} when the organization,
 *   plan, or subscription cannot be loaded. On `create`, throws
 *   {@link ConflictError} (`errors:subscriptionAlreadyExists`) when the
 *   organization already has a non-terminal subscription (checked before the
 *   Stripe call) or when a concurrent create loses the partial-unique-index
 *   race (Postgres `unique_violation`, `23505`). The payment provider is
 *   **fail-closed**: a Stripe failure on `create` / `cancel` / `resume` /
 *   `changePlan` surfaces as `ServiceUnavailableError` from the provider, which
 *   runs *before* any local write, so no local subscription row is created or
 *   mutated when the provider call fails — the Stripe webhook stays the
 *   reconciliation source of truth. If persistence fails *after* the Stripe
 *   create succeeded, the provider is rolled back via `compensateFailedCreate`.
 *   On `changePlan`, a successful provider price update followed by a local
 *   write failure triggers `compensatePlanChange` back to the previous price.
 * - **Side effects:** External Stripe API calls (create / update / cancel /
 *   resume / compensations) and writes to `billing.subscriptions`.
 * - **Notes:** Stripe network calls MUST stay outside the database context to
 *   avoid blocking a Postgres connection on remote I/O. Idempotency for
 *   `create` is forwarded to Stripe via `idempotencyKey` (the
 *   `Idempotency-Key` HTTP header).
 */
export class SubscriptionService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly planService: PlanService,
    private readonly repository: SubscriptionRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async syncFromStripeProviderSubscription(
    provider_subscription_id: string,
    data: SubscriptionUpdateData,
    stripe_event_created_at: Date,
    repositoryOverride?: SubscriptionRepository,
  ) {
    const repository = repositoryOverride ?? this.repository;
    return repository.syncFromStripeProviderSubscription(
      provider_subscription_id,
      data,
      stripe_event_created_at,
    );
  }

  async markCanceledByStripeProviderSubscriptionId(
    provider_subscription_id: string,
    stripe_event_created_at: Date,
    repositoryOverride?: SubscriptionRepository,
  ) {
    const repository = repositoryOverride ?? this.repository;
    return repository.markCanceledByProviderSubscriptionId(
      provider_subscription_id,
      stripe_event_created_at,
    );
  }

  /**
   * sec-B finding #5: existence check on a Stripe-side subscription id, used by the
   * webhook service to distinguish stale-event (no-op) from race-condition (retry)
   * when the sync UPDATE returns null. Routed through the service so tests inject
   * the worker-scoped repository the same way they do for sync/cancel.
   */
  async existsByStripeProviderSubscriptionId(
    provider_subscription_id: string,
    repositoryOverride?: SubscriptionRepository,
  ): Promise<boolean> {
    const repository = repositoryOverride ?? this.repository;
    return repository.existsByProviderSubscriptionId(provider_subscription_id);
  }

  /**
   * Fallback INSERT path for `customer.subscription.created` webhook events
   * whose local row is still missing (sec-B9).
   *
   * @remarks
   * When the Stripe webhook arrives before the HTTP create path has committed
   * the local row (typical B2 race in busy production traffic), the regular
   * sync UPDATE matches 0 rows and the event quietly advances to `processed` —
   * the user's first billing cycle is then invisible to local entitlement.
   * This method resolves the active organization context (`organizationPublicId`
   * is set by the webhook tenancy resolver before the dispatch) and inserts
   * the row with the worker-scoped repository. Returns `null` on a missing
   * organization (catalog drift; should already be caught by the tenancy
   * resolver but defensive here) so the caller can log + advance the ledger
   * rather than throw a non-retryable error.
   */
  async createFromStripeWebhookEvent(input: {
    providerSubscriptionId: string;
    providerCustomerId: string | null;
    planId: number;
    status: string;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    billingCycle: string;
    stripeEventCreatedAt: Date;
    repositoryOverride: SubscriptionRepository;
  }) {
    const organizationId = await input.repositoryOverride.findOrganizationIdFromCurrentContext();
    if (organizationId === null) {
      return null;
    }
    // SubscriptionCreateData does not carry cancel_at_period_end / canceled_at
    // — the subsequent customer.subscription.updated event (Stripe always
    // emits one shortly after .created) will sync those columns through the
    // regular UPDATE path. For a brand-new subscription they are essentially
    // always (false, null) anyway.
    return input.repositoryOverride.create({
      organization_id: organizationId,
      plan_id: input.planId,
      billing_cycle: input.billingCycle,
      status: input.status,
      current_period_start: input.currentPeriodStart,
      current_period_end: input.currentPeriodEnd,
      provider: 'stripe',
      provider_subscription_id: input.providerSubscriptionId,
      ...(input.providerCustomerId !== null
        ? { provider_customer_id: input.providerCustomerId }
        : {}),
      last_stripe_event_created_at: input.stripeEventCreatedAt,
    });
  }

  async list(organization_public_id: string) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      return this.repository.listByOrganization(organization.id);
    });
  }

  async get(organization_public_id: string, subscription_public_id: string) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const subscription = await this.repository.findByPublicId(
        subscription_public_id,
        organization.id,
      );
      if (!subscription) throw new NotFoundError('Subscription');
      return subscription;
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string | undefined,
    idempotencyKey?: string,
  ) {
    const parsed = validateCreateSubscription(body);
    const { organization, plan, createdByUserInternalId } = await withOrganizationDatabaseContext(
      organization_public_id,
      async () => {
        const organization =
          await this.organizationService.requireOrganizationByPublicId(organization_public_id);
        // Reject before the Stripe call when a non-terminal subscription already
        // exists, so a duplicate request never churns the payment provider.
        const existingActive = await this.repository.findActiveByOrganization(organization.id);
        if (existingActive) {
          throw new ConflictError('errors:subscriptionAlreadyExists');
        }
        const plan = await this.planService.requireActivePlanByPublicId(parsed.plan_id);
        const createdByUserInternalId =
          await this.organizationService.resolveUserInternalIdByPublicId(created_by_user_public_id);
        return { organization, plan, createdByUserInternalId };
      },
    );

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + (parsed.billing_cycle === 'yearly' ? 12 : 1));

    // Stripe network call — outside any database context.
    const paymentResult = await this.paymentProvider.createSubscription(
      omitUndefined({
        organization,
        plan,
        billingCycle: parsed.billing_cycle,
        idempotencyKey,
      }),
    );

    try {
      return await withOrganizationDatabaseContext(organization_public_id, async () =>
        this.repository.create(
          omitUndefined({
            organization_id: organization.id,
            plan_id: plan.id,
            billing_cycle: parsed.billing_cycle.toUpperCase() as 'MONTHLY' | 'YEARLY',
            current_period_start: now,
            current_period_end: periodEnd,
            created_by_user_id: createdByUserInternalId ?? undefined,
            provider: paymentResult.providerSubscriptionId ? 'stripe' : undefined,
            provider_subscription_id: paymentResult.providerSubscriptionId,
            provider_customer_id: paymentResult.providerCustomerId,
            // sec-B2: stamp the watermark when Stripe accepted the subscription so a
            // late-arriving `customer.subscription.created` event (whose `created`
            // timestamp predates this moment) is filtered by the monotonic guard and
            // cannot regress the row to a stale earlier state. Unset when Stripe is
            // not configured (no webhook to reconcile, no watermark needed).
            last_stripe_event_created_at: paymentResult.providerSubscriptionId
              ? new Date()
              : undefined,
          }),
        ),
      );
    } catch (error) {
      if (paymentResult.providerSubscriptionId) {
        await this.paymentProvider.compensateFailedCreate(paymentResult.providerSubscriptionId);
      }
      // A concurrent create that lost the race to the partial unique index
      // surfaces as a 409 instead of a 500 (the Stripe sub is already rolled back above).
      if (isPostgresUniqueViolation(error)) {
        throw new ConflictError('errors:subscriptionAlreadyExists');
      }
      throw error;
    }
  }

  async update(organization_public_id: string, subscription_public_id: string, body: unknown) {
    // sec-B1: validateUpdateSubscription enforces an empty-body DTO. Any client trying to
    // PATCH `cancel_at_period_end` (or other billing-state fields) is rejected with 422
    // and must use the dedicated /cancel and /resume routes (which DO call Stripe).
    validateUpdateSubscription(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationByPublicId(organization_public_id);
      const existing = await this.repository.findByPublicId(
        subscription_public_id,
        organization.id,
      );
      if (!existing) throw new NotFoundError('Subscription');
      return existing;
    });
  }

  async changePlan(
    organization_public_id: string,
    subscription_public_id: string,
    body: unknown,
    idempotencyKey?: string,
  ) {
    const parsed = validateChangePlan(body);
    const { organization, plan, subscription, previousPlan } =
      await withOrganizationDatabaseContext(organization_public_id, async () => {
        const organization =
          await this.organizationService.requireOrganizationByPublicId(organization_public_id);
        const plan = await this.planService.requireActivePlanByPublicId(parsed.plan_id);
        const subscription = await this.repository.findByPublicId(
          subscription_public_id,
          organization.id,
        );
        if (!subscription) throw new NotFoundError('Subscription');
        // sec-new-B1: terminal subscriptions cannot have their plan changed
        if (TERMINAL_STATUSES.has(subscription.status)) {
          throw new UnprocessableEntityError('errors:subscriptionNotMutable');
        }
        const previousPlan = await this.planService.requirePlanRecordByInternalId(
          subscription.plan_id,
        );
        return { organization, plan, subscription, previousPlan };
      });

    const providerPriceId = this.paymentProvider.getProviderPriceId(
      plan,
      subscription.billing_cycle === 'YEARLY' ? 'yearly' : 'monthly',
    );
    let providerPlanUpdated = false;

    // Stripe network call — outside any database context. Fail-closed: a provider
    // failure throws ServiceUnavailableError here (before any local write), so the
    // local plan never silently diverges from Stripe. Local-only subscriptions
    // (no provider_subscription_id or no mapped price) skip the call and proceed.
    if (subscription.provider_subscription_id && providerPriceId) {
      await this.paymentProvider.updateSubscriptionPrice(
        subscription.provider_subscription_id,
        providerPriceId,
        idempotencyKey,
      );
      providerPlanUpdated = true;
    }

    const periodStart = new Date(subscription.current_period_start);
    const periodEnd = new Date(subscription.current_period_end);
    try {
      const updated = await withOrganizationDatabaseContext(organization_public_id, async () =>
        this.repository.update(subscription_public_id, organization.id, {
          plan_id: plan.id,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          // sec-B3: stamp the watermark so a stale `customer.subscription.updated` event
          // delivered after this HTTP mutation cannot regress the plan back to its prior
          // price (the webhook guard accepts an event only when its `created` > watermark).
          last_stripe_event_created_at: new Date(),
        }),
      );
      if (!updated) throw new NotFoundError('Subscription');
      return updated;
    } catch (error) {
      if (providerPlanUpdated && subscription.provider_subscription_id) {
        const previousProviderPriceId = this.paymentProvider.getProviderPriceId(
          previousPlan,
          subscription.billing_cycle === 'YEARLY' ? 'yearly' : 'monthly',
        );
        if (previousProviderPriceId) {
          await this.paymentProvider.compensatePlanChange(
            subscription.provider_subscription_id,
            previousProviderPriceId,
          );
        }
      }
      throw error;
    }
  }

  async cancel(
    organization_public_id: string,
    subscription_public_id: string,
    idempotencyKey?: string,
  ) {
    const { organization, subscription } = await withOrganizationDatabaseContext(
      organization_public_id,
      async () => {
        const organization =
          await this.organizationService.requireOrganizationByPublicId(organization_public_id);
        const subscription = await this.repository.findByPublicId(
          subscription_public_id,
          organization.id,
        );
        if (!subscription) throw new NotFoundError('Subscription');
        // sec-new-B1: terminal subscriptions cannot be canceled (they are already non-billable)
        if (TERMINAL_STATUSES.has(subscription.status)) {
          throw new UnprocessableEntityError('errors:subscriptionNotMutable');
        }
        return { organization, subscription };
      },
    );

    // Stripe network call — outside any database context.
    if (subscription.provider_subscription_id) {
      await this.paymentProvider.cancelSubscriptionAtPeriodEnd(
        subscription.provider_subscription_id,
        idempotencyKey,
      );
    }

    const updated = await withOrganizationDatabaseContext(organization_public_id, async () =>
      this.repository.update(subscription_public_id, organization.id, {
        cancel_at_period_end: true,
        // sec-B3: stamp the watermark so a stale Stripe `updated` event arriving later
        // cannot regress `cancel_at_period_end` back to false and silently resume billing.
        last_stripe_event_created_at: new Date(),
      }),
    );
    if (!updated) throw new NotFoundError('Subscription');
    return updated;
  }

  async resume(
    organization_public_id: string,
    subscription_public_id: string,
    idempotencyKey?: string,
  ) {
    const { organization, subscription } = await withOrganizationDatabaseContext(
      organization_public_id,
      async () => {
        const organization =
          await this.organizationService.requireOrganizationByPublicId(organization_public_id);
        const subscription = await this.repository.findByPublicId(
          subscription_public_id,
          organization.id,
        );
        if (!subscription) throw new NotFoundError('Subscription');
        // sec-new-B1: terminal subscriptions cannot be resumed (already non-billable)
        if (TERMINAL_STATUSES.has(subscription.status)) {
          throw new UnprocessableEntityError('errors:subscriptionNotMutable');
        }
        return { organization, subscription };
      },
    );

    // Stripe network call — outside any database context.
    if (subscription.provider_subscription_id) {
      await this.paymentProvider.resumeSubscription(
        subscription.provider_subscription_id,
        idempotencyKey,
      );
    }

    const updated = await withOrganizationDatabaseContext(organization_public_id, async () =>
      this.repository.update(subscription_public_id, organization.id, {
        cancel_at_period_end: false,
        // sec-B4: do NOT force-write `status: 'ACTIVE'`. The Stripe webhook is the source
        // of truth for status — the real value may be PAST_DUE (failed payment) or
        // INCOMPLETE (3DS pending), and forcing ACTIVE here grants a transient
        // entitlement window before the follow-up `customer.subscription.updated` event
        // reconciles. The local row now only flips the cancel toggle.
        //
        // sec-B3: stamp the watermark so a stale Stripe `updated` event arriving later
        // (e.g. delayed from the cancel that we are reversing) cannot re-set
        // `cancel_at_period_end` back to true.
        last_stripe_event_created_at: new Date(),
      }),
    );
    if (!updated) throw new NotFoundError('Subscription');
    return updated;
  }
}
