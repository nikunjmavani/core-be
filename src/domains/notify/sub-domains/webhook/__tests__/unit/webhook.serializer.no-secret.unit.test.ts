import { describe, expect, it } from 'vitest';
import { WebhookSerializer } from '@/domains/notify/sub-domains/webhook/webhook.serializer.js';

const SECRET_FIELDS = ['encrypted_secret', 'secret', 'secret_hash', 'signing_secret'];

function makeWebhookRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    public_id: 'webhook_public_id_xx',
    organization_id: 7,
    url: 'https://example.com/hook',
    encrypted_secret: 'v1:ciphertext.payload.tag',
    events: ['subscription.updated'],
    is_enabled: true,
    deleted_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    created_by_user_id: 9,
    updated_by_user_id: null,
    ...overrides,
  };
}

describe('WebhookSerializer (no-secret regression guard)', () => {
  it('one() strips encrypted_secret from a single webhook row', () => {
    const serialized = WebhookSerializer.one(makeWebhookRow()) as Record<string, unknown>;
    for (const field of SECRET_FIELDS) {
      expect(serialized).not.toHaveProperty(field);
    }
  });

  it('many() strips encrypted_secret from each row', () => {
    const rows = [
      makeWebhookRow({ id: 1, encrypted_secret: 'v1:one.aaa' }),
      makeWebhookRow({ id: 2, encrypted_secret: 'v1:two.bbb' }),
    ];
    const serialized = WebhookSerializer.many(rows) as Record<string, unknown>[];
    expect(serialized).toHaveLength(2);
    for (const row of serialized) {
      for (const field of SECRET_FIELDS) {
        expect(row).not.toHaveProperty(field);
      }
    }
  });

  it('one() does not include any aliased raw secret field', () => {
    const row = makeWebhookRow({ secret: 'plain-secret', secret_hash: 'hash:abc' });
    const serialized = WebhookSerializer.one(row) as Record<string, unknown>;
    expect(serialized).not.toHaveProperty('secret');
    expect(serialized).not.toHaveProperty('secret_hash');
    expect(serialized).not.toHaveProperty('encrypted_secret');
  });

  it('one() preserves non-secret webhook fields intact', () => {
    const serialized = WebhookSerializer.one(makeWebhookRow()) as Record<string, unknown>;
    expect(serialized.public_id).toBe('webhook_public_id_xx');
    expect(serialized.url).toBe('https://example.com/hook');
    expect(serialized.events).toEqual(['subscription.updated']);
    expect(serialized.is_enabled).toBe(true);
  });

  it('serialized JSON output never contains the ciphertext substring', () => {
    const row = makeWebhookRow({ encrypted_secret: 'v1:UNIQUE-CIPHERTEXT-MARKER' });
    const oneJson = JSON.stringify(WebhookSerializer.one(row));
    const manyJson = JSON.stringify(WebhookSerializer.many([row, row]));
    expect(oneJson).not.toContain('UNIQUE-CIPHERTEXT-MARKER');
    expect(oneJson).not.toContain('encrypted_secret');
    expect(manyJson).not.toContain('UNIQUE-CIPHERTEXT-MARKER');
    expect(manyJson).not.toContain('encrypted_secret');
  });
});
