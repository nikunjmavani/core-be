import { describe, expect, it, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('@/infrastructure/database/contexts/tenant-database.context.js', () => ({
  withOrganizationContext: vi.fn(
    async (_organizationPublicId: string, callback: (handle: unknown) => Promise<unknown>) =>
      callback({ tag: 'pinned-handle' }),
  ),
}));

const sqlMock = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/database/connection.js', () => ({
  sql: sqlMock,
}));

import * as stripeWebhookOrganizationUtil from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-organization.util.js';

describe('runStripeWebhookHandlerWithOrganizationContext', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    vi.restoreAllMocks();
  });

  it('throws when subscription event cannot be resolved to an organization', async () => {
    sqlMock.mockResolvedValue([{ public_id: null }]);
    const handler = vi.fn();

    const event = {
      id: 'evt_test',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test', metadata: {} } },
    } as unknown as Stripe.Event;

    await expect(
      stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(event, handler),
    ).rejects.toThrow(/requires organization context/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws when Stripe metadata disagrees with the stored subscription owner', async () => {
    sqlMock.mockResolvedValue([{ public_id: 'org_from_database' }]);
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
      stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(event, handler),
    ).rejects.toThrow(/mismatched organization metadata/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses metadata when the subscription is not yet resolvable from the database', async () => {
    sqlMock.mockResolvedValue([{ public_id: null }]);
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
      stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(event, handler),
    ).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledWith({ tag: 'pinned-handle' });
  });

  it('returns undefined without invoking handler for unhandled events when organization is unresolved', async () => {
    const handler = vi.fn();

    const event = {
      id: 'evt_test',
      type: 'customer.updated',
      data: { object: {} },
    } as unknown as Stripe.Event;

    const result =
      await stripeWebhookOrganizationUtil.runStripeWebhookHandlerWithOrganizationContext(
        event,
        handler,
      );
    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
