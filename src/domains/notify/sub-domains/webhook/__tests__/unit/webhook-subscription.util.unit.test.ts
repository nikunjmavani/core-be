import { describe, expect, it } from 'vitest';
import { webhookSubscribesToEvent } from '../../webhook-subscription.util.js';

describe('webhookSubscribesToEvent', () => {
  it('returns true when event type is in the list', () => {
    expect(
      webhookSubscribesToEvent(
        ['billing.subscription.updated', 'user.created'],
        'billing.subscription.updated',
      ),
    ).toBe(true);
  });

  it('returns false when event type is missing or events is not an array', () => {
    expect(webhookSubscribesToEvent(['user.created'], 'billing.subscription.updated')).toBe(false);
    expect(webhookSubscribesToEvent(null, 'billing.subscription.updated')).toBe(false);
  });
});
