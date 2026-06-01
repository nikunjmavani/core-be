import type Stripe from 'stripe';
import { sql } from '@/infrastructure/database/connection.js';
import type { WorkerContextDatabaseHandle } from '@/infrastructure/database/utils/database-handle.types.js';
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const SUBSCRIPTION_STRIPE_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function stripeEventRequiresOrganizationContext(eventType: string): boolean {
  return SUBSCRIPTION_STRIPE_EVENT_TYPES.has(eventType);
}

const ORGANIZATION_ID_METADATA_KEY = 'organization_id';

function readOrganizationPublicIdFromStripeMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | undefined {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- ORGANIZATION_ID_METADATA_KEY is a module constant.
  const organizationPublicId = metadata[ORGANIZATION_ID_METADATA_KEY];
  return typeof organizationPublicId === 'string' && organizationPublicId.length > 0
    ? organizationPublicId
    : undefined;
}

async function resolveOrganizationPublicIdByProviderSubscriptionId(
  provider_subscription_id: string,
): Promise<string | undefined> {
  const rows = await sql<{ public_id: string | null }[]>`
    SELECT billing.resolve_organization_public_id_for_stripe_subscription(${provider_subscription_id}) AS public_id
  `;
  const organizationPublicId = rows[0]?.public_id;
  return organizationPublicId ?? undefined;
}

/**
 * Resolves tenancy scope for Stripe webhook side effects (RLS requires app.current_organization_id).
 */
export async function resolveOrganizationPublicIdForStripeEvent(
  event: Stripe.Event,
): Promise<string | undefined> {
  const stripeObject = event.data.object as Stripe.Subscription;

  const fromMetadata = readOrganizationPublicIdFromStripeMetadata(stripeObject.metadata);
  if (fromMetadata !== undefined) {
    return fromMetadata;
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    return resolveOrganizationPublicIdByProviderSubscriptionId(stripeObject.id);
  }

  return undefined;
}

/**
 * Runs billing mutations under SET LOCAL app.current_organization_id for RLS policies.
 */
export async function runWithOrganizationPublicIdForStripeWebhook<T>(
  organizationPublicId: string,
  callback: (databaseHandle: WorkerContextDatabaseHandle) => Promise<T>,
): Promise<T> {
  return withOrganizationContext(organizationPublicId, callback);
}

/**
 * Resolves the organization scope for `event` and runs `handler` inside that
 * RLS context, returning `undefined` for events that legitimately have no
 * organization (e.g. unhandled global event types). Throws when the event type
 * requires tenancy (subscription lifecycle) but no organization could be found,
 * so the caller marks the ledger row failed instead of silently skipping.
 */
export async function runStripeWebhookHandlerWithOrganizationContext<T>(
  event: Stripe.Event,
  handler: (databaseHandle: WorkerContextDatabaseHandle) => Promise<T>,
): Promise<T | undefined> {
  const organizationPublicId = await resolveOrganizationPublicIdForStripeEvent(event);
  if (organizationPublicId === undefined) {
    logger.warn(
      { eventId: event.id, eventType: event.type },
      'stripe.webhook.organization_not_resolved',
    );

    if (stripeEventRequiresOrganizationContext(event.type)) {
      throw new Error(
        `Stripe webhook event ${event.id} (${event.type}) requires organization context but organization could not be resolved`,
      );
    }

    return undefined;
  }

  return runWithOrganizationPublicIdForStripeWebhook(organizationPublicId, handler);
}
