import { describe, expect, it } from 'vitest';
import {
  serializeWebauthnCredential,
  serializeWebauthnCredentialList,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn.serializer.js';
import type { WebauthnCredentialRow } from '@/domains/auth/sub-domains/auth-webauthn/webauthn-credential.repository.js';

/**
 * Passkey serializer — the allow-list between a credential row and the owner-facing response.
 *
 * @remarks
 * The row carries material that must never leave the server: the credential `public_key`, the raw
 * WebAuthn `credential_id` blob, the signature `counter`, and internal auto-increment ids. The
 * serializer's own TSDoc states this as a NEVER, and until now nothing enforced it — a field added
 * to the row type would flow straight out through a spread or an incautious edit.
 *
 * These tests are written as an exact key-set assertion rather than a set of individual absences,
 * so a *newly added* sensitive column fails here too, not just the ones known today.
 */
function credentialRow(overrides: Partial<WebauthnCredentialRow> = {}): WebauthnCredentialRow {
  return {
    id: 42,
    user_id: 7,
    public_id: 'wac_abcdefghijklmnopqrstu',
    credential_id: Buffer.from('raw-credential-id-blob'),
    public_key: Buffer.from('secret-public-key-material'),
    counter: 17,
    device_type: 'singleDevice',
    backed_up: false,
    transports: ['internal', 'hybrid'],
    created_at: new Date('2026-03-01T10:00:00.000Z'),
    last_used_at: new Date('2026-04-01T10:00:00.000Z'),
    revoked_at: null,
    ...overrides,
  } as unknown as WebauthnCredentialRow;
}

describe('serializeWebauthnCredential', () => {
  it('emits exactly the six documented fields and nothing else', () => {
    // The load-bearing assertion. An exact key set means a new sensitive column on the row cannot
    // reach the response without this failing first.
    expect(Object.keys(serializeWebauthnCredential(credentialRow())).sort()).toEqual([
      'backed_up',
      'created_at',
      'device_type',
      'id',
      'last_used_at',
      'transports',
    ]);
  });

  it('exposes the public id as `id`, not the internal auto-increment id', () => {
    // `id` on the wire is the opaque public id the DELETE route accepts. Emitting the numeric id
    // would both leak row counts and make the documented delete route unusable.
    const serialized = serializeWebauthnCredential(credentialRow({ public_id: 'wac_xyz' }));

    expect(serialized.id).toBe('wac_xyz');
    expect(serialized.id).not.toBe(42);
  });

  it.each([
    ['public_key', 'public_key'],
    ['credential_id', 'credential_id'],
    ['counter', 'counter'],
    ['user_id', 'user_id'],
    ['revoked_at', 'revoked_at'],
  ])('never emits %s', (_label, field) => {
    // Named individually as well as by the key-set assertion, so a failure says which field leaked.
    expect(serializeWebauthnCredential(credentialRow())).not.toHaveProperty(field);
  });

  it('does not leak credential material anywhere in the serialized output', () => {
    // Belt and braces: catches material smuggled into a differently-named field.
    const serialized = JSON.stringify(serializeWebauthnCredential(credentialRow()));

    expect(serialized).not.toContain('secret-public-key-material');
    expect(serialized).not.toContain('raw-credential-id-blob');
  });

  it('passes through the display fields verbatim', () => {
    const row = credentialRow({
      device_type: 'multiDevice',
      backed_up: true,
      transports: ['usb', 'nfc'],
    });

    expect(serializeWebauthnCredential(row)).toMatchObject({
      device_type: 'multiDevice',
      backed_up: true,
      transports: ['usb', 'nfc'],
    });
  });

  it('preserves a null last_used_at for a passkey never used', () => {
    // Distinct from "used at the epoch" — the UI renders these differently.
    expect(
      serializeWebauthnCredential(credentialRow({ last_used_at: null })).last_used_at,
    ).toBeNull();
  });

  it('preserves an empty transports list', () => {
    expect(serializeWebauthnCredential(credentialRow({ transports: [] })).transports).toEqual([]);
  });

  it('uses snake_case body keys per the API contract', () => {
    for (const key of Object.keys(serializeWebauthnCredential(credentialRow()))) {
      expect(key).not.toMatch(/[A-Z]/);
    }
  });
});

describe('serializeWebauthnCredentialList', () => {
  it('serializes every row', () => {
    const rows = [credentialRow({ public_id: 'wac_one' }), credentialRow({ public_id: 'wac_two' })];

    expect(serializeWebauthnCredentialList(rows).map((entry) => entry.id)).toEqual([
      'wac_one',
      'wac_two',
    ]);
  });

  it('applies the same allow-list to every entry', () => {
    // A list path that bypassed the per-row serializer would leak on every passkey at once.
    const serialized = serializeWebauthnCredentialList([credentialRow(), credentialRow()]);

    for (const entry of serialized) {
      expect(Object.keys(entry).sort()).toEqual([
        'backed_up',
        'created_at',
        'device_type',
        'id',
        'last_used_at',
        'transports',
      ]);
    }
  });

  it('returns an empty array for a user with no passkeys', () => {
    expect(serializeWebauthnCredentialList([])).toEqual([]);
  });

  it('preserves row order', () => {
    // The repository orders the rows; the serializer must not reorder them.
    const rows = ['wac_c', 'wac_a', 'wac_b'].map((publicId) =>
      credentialRow({ public_id: publicId }),
    );

    expect(serializeWebauthnCredentialList(rows).map((entry) => entry.id)).toEqual([
      'wac_c',
      'wac_a',
      'wac_b',
    ]);
  });
});
