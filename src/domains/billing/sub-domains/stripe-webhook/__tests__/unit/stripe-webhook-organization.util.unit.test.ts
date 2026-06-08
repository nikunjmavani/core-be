import { describe, expect, it, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('@/infrastructure/database/contexts/tenant-database.context.js', () => ({
  withOrganizationContext: vi.fn(
    async (_organizationPublicId: string, callback: (handle: unknown) => Promise<unknown>) =>
      callback({ tag: 'pinned-handle' }),
  ),
}));

import * as stripeWebhookOrganizationUtil from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js';
import type { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

/**
 * Build a minimal `StripeWebhookEventRepository` stub that returns the supplied
 * `public_id` from `resolveOrganizationPublicIdByProviderSubscriptionId`. Used by
 * the tests below to control resolver state without touching Postgres.
 *
 * Architecturally the util now takes a `repository` parameter (refactored away
 * from the raw `sql\`\`` it previously used) so the DB query lives on the
 * repository. The tests inject this stub via that parameter.
 */
function buildStripeWebhookEventRepositoryStub(
  resolved: string | undefined,
): StripeWebhookEventRepository {
  return {
    resolveOrganizationPublicIdByProviderSubscriptionId: vi
      .fn<(provider_subscription_id: string) => Promise<string | undefined>>()
      .mockResolvedValue(resolved),
  } as unknown as StripeWebhookEventRepository;
}

describe('runStripeWebhookHandlerWithOrganizationContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when subscription event cannot be resolved to an organization', async () => {
    const repository = buildStripeWebhookEventRepositoryStub(undefined);
    const handler = vi.fn();

    const event = {
      id: 'evt_test',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test', metadata: {} } },
    } as unknown as Stripe.Event;

    await expect(
      stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(
        event,
        repository,
        handler,
      ),
    ).rejects.toThrow(/requires organization context/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws when Stripe metadata disagrees with the stored subscription owner', async () => {
    const repository = buildStripeWebhookEventRepositoryStub('org_from_database');
    const handler = vi.fn();

    const event = {
      id: 'evt_mismatch',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test',
          metadata: { organization_id: 'org_from_metadata' },
        },
      },
    } as unknown as Stripe.Event;

    await expect(
      stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(
        event,
        repository,
        handler,
      ),
    ).rejects.toThrow(/mismatched organization metadata/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses metadata when the subscription is not yet resolvable from the database', async () => {
    const repository = buildStripeWebhookEventRepositoryStub(undefined);
    const handler = vi.fn().mockResolvedValue('ok');

    const event = {
      id: 'evt_metadata_only',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_test',
          metadata: { organization_id: 'org_from_metadata' },
        },
      },
    } as unknown as Stripe.Event;

    await expect(
      stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(
        event,
        repository,
        handler,
      ),
    ).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledWith({ tag: 'pinned-handle' });
  });

  it('returns undefined without invoking handler for unhandled events when organization is unresolved', async () => {
    const repository = buildStripeWebhookEventRepositoryStub(undefined);
    const handler = vi.fn();

    const event = {
      id: 'evt_test',
      type: 'customer.updated',
      data: { object: {} },
    } as unknown as Stripe.Event;

    const result =
      await stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(
        event,
        repository,
        handler,
      );
    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(repository.resolveOrganizationPublicIdByProviderSubscriptionId).not.toHaveBeenCalled();
  });
});
