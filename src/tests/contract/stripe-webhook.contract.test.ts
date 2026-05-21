import { beforeEach, describe, expect, test, vi } from 'vitest';

const drizzleOutboundWebhookDatabaseUpdateSpy = vi.hoisted(() => vi.fn());
const stripeWebhookTryClaimEventMock = vi.hoisted(() => vi.fn().mockResolvedValue('claimed'));
const stripeWebhookMarkProcessedMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const stripeWebhookMarkFailedMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    update: drizzleOutboundWebhookDatabaseUpdateSpy,
  },
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js', () => ({
  runStripeWebhookHandlerWithOrganizationContext: vi.fn(
    async (_event: unknown, handler: (databaseHandle: unknown) => Promise<void>) =>
      handler({ update: drizzleOutboundWebhookDatabaseUpdateSpy }),
  ),
}));

import { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { constructStripeWebhookEvent } from '@/infrastructure/payment/stripe.client.js';
import { env } from '@/shared/config/env.config.js';

import webhookSubscriptionCreatedBaseline from './fixtures/stripe/events/customer.subscription.created.json' with { type: 'json' };
import webhookSubscriptionDeletedBaseline from './fixtures/stripe/events/customer.subscription.deleted.json' with { type: 'json' };
import webhookSubscriptionUpdatedBaseline from './fixtures/stripe/events/customer.subscription.updated.json' with { type: 'json' };
import { buildStripeWebhookTestSignatureHeader } from './helpers/stripe-signature.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';
import { StripeEventEnvelopeSubscriptionWebhookContractSchema } from './schemas/stripe.schemas.js';

registerThirdPartyContractTestIsolationHooks();

function mergeStripeOutboundWebhookSyntheticTimestampFieldOutbound(parameters: {
  baselineStripeWebhookEnvelope: Record<string, unknown>;
}): Record<string, unknown> {
  const mergedStripeOutboundWebhookEnvelopeCopy = structuredClone(
    parameters.baselineStripeWebhookEnvelope,
  );
  mergedStripeOutboundWebhookEnvelopeCopy.created = Math.floor(Date.now() / 1000);
  return mergedStripeOutboundWebhookEnvelopeCopy;
}

function createFluentDrizzleUpdateMockBuilderReturningRowsOutbound(
  outboundReturningResolvedRowsPayload: unknown[],
) {
  const fluentDrizzleUpdateBuilderReturningOutbound: Record<string, unknown> = {};
  fluentDrizzleUpdateBuilderReturningOutbound.set = vi.fn(
    () => fluentDrizzleUpdateBuilderReturningOutbound,
  );
  fluentDrizzleUpdateBuilderReturningOutbound.where = vi.fn(() => ({
    returning: vi.fn(async () => outboundReturningResolvedRowsPayload),
  }));
  return fluentDrizzleUpdateBuilderReturningOutbound;
}

describe('Stripe webhook ingestion contract (`constructStripeWebhookEvent` + StripeWebhookService)', () => {
  const subscriptionRepositoryOutbound = new SubscriptionRepository();
  const subscriptionServiceOutbound = new SubscriptionService(
    {} as never,
    {} as never,
    subscriptionRepositoryOutbound,
    {
      isConfigured: () => false,
      getProviderPriceId: () => null,
      createSubscription: async () => ({}),
      cancelSubscriptionAtPeriodEnd: async () => {},
      resumeSubscription: async () => {},
      updateSubscriptionPrice: async () => false,
      compensateFailedCreate: async () => {},
      compensatePlanChange: async () => {},
    },
  );
  const webhookEventHandlerServiceOutbound = new StripeWebhookService(subscriptionServiceOutbound, {
    tryClaimEvent: stripeWebhookTryClaimEventMock,
    markProcessed: stripeWebhookMarkProcessedMock,
    markFailed: stripeWebhookMarkFailedMock,
  } as never);
  let webhookStripeSigningSecretBaseline: string;

  beforeEach(() => {
    drizzleOutboundWebhookDatabaseUpdateSpy.mockReset();
    webhookStripeSigningSecretBaseline = env.STRIPE_WEBHOOK_SECRET ?? '';
  });

  test('customer.subscription.updated verifies signature payload and persists subscription deltas', async () => {
    const validatedBaselineEnvelopeOutbound =
      StripeEventEnvelopeSubscriptionWebhookContractSchema.parse(
        webhookSubscriptionUpdatedBaseline,
      );
    const mergedStripeOutboundWebhookEnvelope =
      mergeStripeOutboundWebhookSyntheticTimestampFieldOutbound({
        baselineStripeWebhookEnvelope: validatedBaselineEnvelopeOutbound as Record<string, unknown>,
      });
    const webhookRawPayloadOutboundUtf8 = JSON.stringify(mergedStripeOutboundWebhookEnvelope);
    const stripeSignatureHeaderOutbound = buildStripeWebhookTestSignatureHeader({
      rawPayload: webhookRawPayloadOutboundUtf8,
      webhookSigningSecret: webhookStripeSigningSecretBaseline,
    });

    drizzleOutboundWebhookDatabaseUpdateSpy.mockImplementation((tableOutbound) => {
      expect(tableOutbound).toBe(subscriptions);
      return createFluentDrizzleUpdateMockBuilderReturningRowsOutbound([{ synced: true }]);
    });

    const verifiedStripeEventOutbound = constructStripeWebhookEvent(
      webhookRawPayloadOutboundUtf8,
      stripeSignatureHeaderOutbound,
    );

    await webhookEventHandlerServiceOutbound.handleEvent(verifiedStripeEventOutbound);

    expect(drizzleOutboundWebhookDatabaseUpdateSpy).toHaveBeenCalledOnce();
    expect(drizzleOutboundWebhookDatabaseUpdateSpy.mock.calls[0]?.[0]).toBe(subscriptions);
  });

  test('customer.subscription.created follows the subscription webhook envelope schema', async () => {
    const validatedBaselineEnvelopeOutbound =
      StripeEventEnvelopeSubscriptionWebhookContractSchema.parse(
        webhookSubscriptionCreatedBaseline,
      );
    const mergedStripeOutboundWebhookEnvelope =
      mergeStripeOutboundWebhookSyntheticTimestampFieldOutbound({
        baselineStripeWebhookEnvelope: validatedBaselineEnvelopeOutbound as Record<string, unknown>,
      });
    const webhookRawPayloadOutboundUtf8 = JSON.stringify(mergedStripeOutboundWebhookEnvelope);
    const stripeSignatureHeaderOutbound = buildStripeWebhookTestSignatureHeader({
      rawPayload: webhookRawPayloadOutboundUtf8,
      webhookSigningSecret: webhookStripeSigningSecretBaseline,
    });

    drizzleOutboundWebhookDatabaseUpdateSpy.mockImplementation((tableOutbound) => {
      expect(tableOutbound).toBe(subscriptions);
      return createFluentDrizzleUpdateMockBuilderReturningRowsOutbound([{ synced: true }]);
    });

    const verifiedStripeEventOutbound = constructStripeWebhookEvent(
      Buffer.from(webhookRawPayloadOutboundUtf8),
      stripeSignatureHeaderOutbound,
    );

    await webhookEventHandlerServiceOutbound.handleEvent(verifiedStripeEventOutbound);
    expect(drizzleOutboundWebhookDatabaseUpdateSpy).toHaveBeenCalled();
  });

  test('customer.subscription.deleted marks subscription canceled via returning()', async () => {
    const validatedBaselineEnvelopeOutbound =
      StripeEventEnvelopeSubscriptionWebhookContractSchema.parse(
        webhookSubscriptionDeletedBaseline,
      );
    const mergedStripeOutboundWebhookEnvelope =
      mergeStripeOutboundWebhookSyntheticTimestampFieldOutbound({
        baselineStripeWebhookEnvelope: validatedBaselineEnvelopeOutbound as Record<string, unknown>,
      });
    const webhookRawPayloadOutboundUtf8 = JSON.stringify(mergedStripeOutboundWebhookEnvelope);
    const stripeSignatureHeaderOutbound = buildStripeWebhookTestSignatureHeader({
      rawPayload: webhookRawPayloadOutboundUtf8,
      webhookSigningSecret: webhookStripeSigningSecretBaseline,
    });

    drizzleOutboundWebhookDatabaseUpdateSpy.mockImplementation((tableOutbound) => {
      expect(tableOutbound).toBe(subscriptions);
      return createFluentDrizzleUpdateMockBuilderReturningRowsOutbound([{ canceled: true }]);
    });

    const verifiedStripeEventOutbound = constructStripeWebhookEvent(
      webhookRawPayloadOutboundUtf8,
      stripeSignatureHeaderOutbound,
    );
    await webhookEventHandlerServiceOutbound.handleEvent(verifiedStripeEventOutbound);

    expect(drizzleOutboundWebhookDatabaseUpdateSpy).toHaveBeenCalledOnce();
  });
});
