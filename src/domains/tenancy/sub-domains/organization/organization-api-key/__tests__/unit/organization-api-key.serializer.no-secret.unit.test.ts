import { describe, it, expect } from 'vitest';
import { serializeOrganizationApiKey } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.serializer.js';

describe('serializeOrganizationApiKey — no secret leakage', () => {
  const row = {
    id: 1,
    public_id: 'apikey_public_abc',
    organization_id: 1,
    name: 'CI key',
    key_hash: 'super-secret-hash-value',
    key_prefix: 'ak_prefix12345',
    scopes: ['billing:read'],
    last_used_at: new Date('2026-01-01T00:00:00Z'),
    expires_at: null,
    status: 'ACTIVE',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
    deleted_at: null,
    created_by_user_id: 1,
    updated_by_user_id: null,
  };

  it('does not expose key_hash or raw secret fields', () => {
    const serialized = serializeOrganizationApiKey(row, 'org_public_abc');
    const json = JSON.stringify(serialized);
    expect(json).not.toContain('super-secret-hash-value');
    expect(serialized).not.toHaveProperty('key_hash');
    expect(serialized).not.toHaveProperty('secret');
    expect(serialized).not.toHaveProperty('raw_key');
    expect(serialized).not.toHaveProperty('token_hash');
  });

  it('exposes only the display prefix, not the full secret', () => {
    const serialized = serializeOrganizationApiKey(row, 'org_public_abc');
    expect(serialized.key_prefix).toBe('ak_prefix12345');
    expect(serialized.key_prefix.length).toBeLessThan(64);
  });

  it('maps public_id to id and organization public id', () => {
    const serialized = serializeOrganizationApiKey(row, 'org_public_abc');
    expect(serialized.id).toBe('apikey_public_abc');
    expect(serialized.organization_id).toBe('org_public_abc');
  });
});
