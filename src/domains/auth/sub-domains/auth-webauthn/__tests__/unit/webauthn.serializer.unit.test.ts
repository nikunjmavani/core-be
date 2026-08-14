import { describe, expect, it } from 'vitest';
import {
  serializeWebauthnCredential,
  serializeWebauthnCredentialList,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn.serializer.js';
import type { WebauthnCredentialRow } from '@/domains/auth/sub-domains/auth-webauthn/webauthn-credential.repository.js';

/**
 * Mirror of `auth-session.serializer.no-secret.unit.test.ts` for the passkey serializer. The row
 * it shapes carries credential material (`public_key`), the raw WebAuthn `credential_id` blob, the
 * clone-detection signature `counter`, and internal ids — none of which may reach the owner-facing
 * `GET /auth/me/webauthn/credentials` response.
 */

const PUBLIC_KEY_SENTINEL = 'pk-'.concat('z'.repeat(64));
const CREDENTIAL_ID_SENTINEL = 'raw-webauthn-credential-blob';

function buildRow(overrides: Partial<WebauthnCredentialRow> = {}): WebauthnCredentialRow {
  return {
    id: 1,
    public_id: 'wac_a1b2c3d4e5f6g7h8i9j0k',
    user_id: 42,
    credential_id: CREDENTIAL_ID_SENTINEL,
    public_key: PUBLIC_KEY_SENTINEL,
    counter: 17,
    device_type: 'multiDevice',
    backed_up: true,
    transports: ['internal', 'hybrid'],
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    last_used_at: new Date('2026-01-02T03:04:05.000Z'),
    revoked_at: null,
    ...overrides,
  } as WebauthnCredentialRow;
}

describe('webauthn.serializer', () => {
  it('emits exactly the owner-facing snake_case contract', () => {
    const output = serializeWebauthnCredential(buildRow());
    expect(Object.keys(output).sort()).toEqual([
      'backed_up',
      'created_at',
      'device_type',
      'id',
      'last_used_at',
      'transports',
    ]);
    // Every emitted key is snake_case (the API body-casing contract) — `id` is the sole exception
    // by design, being the opaque external identifier.
    for (const key of Object.keys(output)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('omits credential material and the clone-detection counter', () => {
    const output = serializeWebauthnCredential(buildRow());
    const keys = Object.keys(output);
    expect(keys).not.toContain('public_key');
    expect(keys).not.toContain('credential_id');
    expect(keys).not.toContain('counter');
    // Belt-and-braces: neither secret may appear anywhere in the serialized JSON, including
    // nested inside another field.
    const json = JSON.stringify(output);
    expect(json).not.toContain(PUBLIC_KEY_SENTINEL);
    expect(json).not.toContain(CREDENTIAL_ID_SENTINEL);
  });

  it('exposes the opaque public id as `id` and drops every internal identifier', () => {
    const output = serializeWebauthnCredential(buildRow());
    // `id` is the value DELETE /auth/me/webauthn/credentials/{credential_id} accepts — never the
    // sequential row id, which would leak how many passkeys the platform has registered.
    expect(output.id).toBe('wac_a1b2c3d4e5f6g7h8i9j0k');
    const keys = Object.keys(output);
    expect(keys).not.toContain('public_id');
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('revoked_at');
    expect(JSON.stringify(output)).not.toContain('"id":1');
  });

  it('passes the display fields through, including a never-used passkey', () => {
    expect(serializeWebauthnCredential(buildRow())).toEqual({
      id: 'wac_a1b2c3d4e5f6g7h8i9j0k',
      device_type: 'multiDevice',
      backed_up: true,
      transports: ['internal', 'hybrid'],
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      last_used_at: new Date('2026-01-02T03:04:05.000Z'),
    });
    // A freshly registered passkey has never been used; the field stays in the contract as null.
    expect(serializeWebauthnCredential(buildRow({ last_used_at: null })).last_used_at).toBeNull();
  });

  it('preserves order in the list serializer and leaks nothing across rows', () => {
    const output = serializeWebauthnCredentialList([
      buildRow({ public_id: 'wac_first0000000000000' }),
      buildRow({ public_id: 'wac_second000000000000' }),
    ]);
    expect(output.map((credential) => credential.id)).toEqual([
      'wac_first0000000000000',
      'wac_second000000000000',
    ]);
    expect(JSON.stringify(output)).not.toContain(PUBLIC_KEY_SENTINEL);
    expect(serializeWebauthnCredentialList([])).toEqual([]);
  });
});
