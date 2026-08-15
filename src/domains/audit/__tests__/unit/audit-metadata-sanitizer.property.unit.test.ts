import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { AuditSerializer } from '@/domains/audit/audit.serializer.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

/**
 * Layer 2 (property) for the audit metadata sanitizer — the last gate between recorded forensic
 * metadata and what an admin's browser receives. Its rule set is textual (a secret-name pattern,
 * a `*_public_id` exemption), which is exactly what example tests under-serve: the pattern must
 * hold for any affix composition, and the exemption must beat the pattern for any collision
 * (`api_key_public_id` contains `api_key` AND ends in `public_id`).
 */

function baseRow(metadata: Record<string, unknown>) {
  return {
    action: 'role.changed',
    resource_type: 'role',
    severity: 'INFO',
    created_at: '2026-06-07T00:00:00.000Z',
    metadata,
  } as never;
}

function serializedMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const [entry] = AuditSerializer.many([baseRow(metadata)]);
  return (entry as { metadata: Record<string, unknown> }).metadata;
}

/** Key stems the secret pattern matches, composed with arbitrary safe affixes. */
const secretStem = fc.constantFrom(
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'api-key',
  'apikey',
  'authorization',
  'credential',
  'private_key',
  'access_key',
);
const affix = fc.stringMatching(/^[a-z0-9_]{0,10}$/).filter((s) => !s.endsWith('public_id'));

describe('audit metadata sanitizer (property)', () => {
  it('redacts the VALUE of any key containing a secret stem, whatever surrounds the stem — but keeps the key visible', () => {
    fc.assert(
      fc.property(
        secretStem,
        affix,
        affix,
        fc.string({ maxLength: 40 }),
        (stem, pre, post, value) => {
          const key = `${pre}${stem}${post}`;
          const sanitized = serializedMetadata({ [key]: value, harmless: 'kept' });
          // The key survives (an admin must see the field existed); the value never does.
          expect(Object.keys(sanitized)).toContain(key);
          expect(sanitized[key]).toBe('[REDACTED]');
          expect(sanitized.harmless).toBe('kept');
        },
      ),
      propertyOptions,
    );
  });

  it('the *_public_id exemption beats the secret pattern for every colliding key', () => {
    fc.assert(
      fc.property(secretStem, fc.stringMatching(/^[a-z0-9]{21}$/), (stem, id) => {
        const key = `${stem}_public_id`;
        const sanitized = serializedMetadata({ [key]: id });
        // `api_key_public_id` is the forensic pivot admins need — redacting it because its
        // name brushes `api_key` would blind exactly the investigations audit exists for.
        expect(sanitized[key]).toBe(id);
      }),
      propertyOptions,
    );
  });

  it('preserves any key without a secret stem verbatim — the sanitizer is a filter, not a rewrite', () => {
    const safeKey = fc
      .stringMatching(/^[a-z][a-z0-9_]{0,20}$/)
      .filter(
        (key) =>
          !/password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?key/i.test(
            key,
          ),
      );
    fc.assert(
      fc.property(safeKey, fc.string({ maxLength: 40 }), (key, value) => {
        const sanitized = serializedMetadata({ [key]: value });
        if (key in sanitized) {
          // If the key survives the internal-key filter it must arrive untouched — a
          // sanitizer that mutates benign values corrupts the forensic record.
          expect(sanitized[key]).toBe(value);
        }
      }),
      propertyOptions,
    );
  });

  it('passes non-object metadata through unchanged for any primitive or array', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 20 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
        ),
        (metadata) => {
          const [entry] = AuditSerializer.many([baseRow(metadata as never)]);
          expect((entry as { metadata: unknown }).metadata).toEqual(metadata);
        },
      ),
      propertyOptions,
    );
  });
});
