import { describe, expect, it } from 'vitest';
import type { WebauthnCredentialRow } from '@/domains/auth/sub-domains/auth-webauthn/webauthn-credential.repository.js';
import {
  serializeWebauthnCredential,
  serializeWebauthnCredentialList,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn.serializer.js';

/**
 * The passkey row carries credential secrets — the public key, the signature counter, the raw
 * credential id and the internal user id. This serializer is the only thing standing between that
 * row and the response body of `GET /auth/me/passkeys`, and it had no test. A field added to the
 * schema and reflexively spread here would publish credential material.
 */
describe('webauthn.serializer', () => {
  function buildRow(overrides: Partial<WebauthnCredentialRow> = {}): WebauthnCredentialRow {
    return {
      id: 42,
      public_id: 'pky_abcdefghijklmnopqrstu',
      user_id: 7,
      credential_id: 'raw-credential-id-bytes',
      public_key: 'SECRET-PUBLIC-KEY-BYTES',
      counter: 17,
      device_type: 'singleDevice',
      backed_up: false,
      transports: ['internal', 'hybrid'],
      created_at: new Date('2026-01-02T03:04:05.000Z'),
      last_used_at: new Date('2026-02-03T04:05:06.000Z'),
      revoked_at: null,
      ...overrides,
    } as unknown as WebauthnCredentialRow;
  }

  describe('serializeWebauthnCredential', () => {
    it('emits exactly the six public fields', () => {
      const result = serializeWebauthnCredential(buildRow());

      expect(Object.keys(result).sort()).toEqual(
        ['backed_up', 'created_at', 'device_type', 'id', 'last_used_at', 'transports'].sort(),
      );
    });

    it.each([
      ['public_key', 'public_key'],
      ['credential_id', 'credential_id'],
      ['counter', 'counter'],
      ['user_id', 'user_id'],
      ['revoked_at', 'revoked_at'],
    ])('never leaks %s', (field) => {
      const result = serializeWebauthnCredential(buildRow());

      expect(result).not.toHaveProperty(field);
    });

    it('exposes the PUBLIC id as `id` and never the internal numeric id', () => {
      const result = serializeWebauthnCredential(
        buildRow({ id: 42 } as Partial<WebauthnCredentialRow>),
      );

      expect(result.id).toBe('pky_abcdefghijklmnopqrstu');
      expect(result.id).not.toBe(42);
    });

    it('passes the remaining public fields through unchanged', () => {
      const row = buildRow();

      const result = serializeWebauthnCredential(row);

      expect(result).toEqual({
        id: 'pky_abcdefghijklmnopqrstu',
        device_type: 'singleDevice',
        backed_up: false,
        transports: ['internal', 'hybrid'],
        created_at: row.created_at,
        last_used_at: row.last_used_at,
      });
    });

    it('preserves a true backed_up flag (not coerced or dropped)', () => {
      const result = serializeWebauthnCredential(buildRow({ backed_up: true }));

      expect(result.backed_up).toBe(true);
    });

    it('emits a never-used passkey with last_used_at null', () => {
      const result = serializeWebauthnCredential(
        buildRow({ last_used_at: null } as Partial<WebauthnCredentialRow>),
      );

      expect(result.last_used_at).toBeNull();
    });

    it('emits an empty transports array as an empty array, not null', () => {
      const result = serializeWebauthnCredential(
        buildRow({ transports: [] } as unknown as Partial<WebauthnCredentialRow>),
      );

      expect(result.transports).toEqual([]);
    });
  });

  describe('serializeWebauthnCredentialList', () => {
    it('maps every row through the single-credential serializer', () => {
      const rows = [
        buildRow({ public_id: 'pky_aaaaaaaaaaaaaaaaaaaaa' }),
        buildRow({ public_id: 'pky_bbbbbbbbbbbbbbbbbbbbb' }),
      ];

      const result = serializeWebauthnCredentialList(rows);

      expect(result.map((credential) => credential.id)).toEqual([
        'pky_aaaaaaaaaaaaaaaaaaaaa',
        'pky_bbbbbbbbbbbbbbbbbbbbb',
      ]);
    });

    it('leaks nothing across a list either', () => {
      const result = serializeWebauthnCredentialList([buildRow(), buildRow()]);

      for (const credential of result) {
        expect(credential).not.toHaveProperty('public_key');
        expect(credential).not.toHaveProperty('credential_id');
      }
    });

    it('returns an empty array for no rows', () => {
      expect(serializeWebauthnCredentialList([])).toEqual([]);
    });
  });
});
