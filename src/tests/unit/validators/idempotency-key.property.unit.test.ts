import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  parseIdempotencyKeyHeader,
} from '@/shared/utils/idempotency/idempotency-key.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const IDEMPOTENCY_KEY_ALLOWED_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:~+/=-'.split('');

const idempotencyKeyArbitrary = fc
  .array(fc.constantFrom(...IDEMPOTENCY_KEY_ALLOWED_CHARACTERS), {
    minLength: 1,
    maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
  })
  .map((characters) => characters.join(''));

const propertyOptions = propertyAssertOptions();

describe('idempotency key (property)', () => {
  it('parseIdempotencyKeyHeader accepts allowed charset and length', () => {
    fc.assert(
      fc.property(idempotencyKeyArbitrary, (key) => {
        expect(parseIdempotencyKeyHeader(key)).toEqual({ kind: 'valid', value: key });
      }),
      propertyOptions,
    );
  });

  it('trims surrounding ASCII whitespace before validation', () => {
    fc.assert(
      fc.property(idempotencyKeyArbitrary, (key) => {
        const padded = ` \t ${key}\t `;
        expect(parseIdempotencyKeyHeader(padded)).toEqual({ kind: 'valid', value: key });
      }),
      propertyOptions,
    );
  });

  it('rejects keys longer than max length after trim', () => {
    const tooLongKeyArbitrary = fc
      .array(fc.constantFrom(...IDEMPOTENCY_KEY_ALLOWED_CHARACTERS), {
        minLength: IDEMPOTENCY_KEY_MAX_LENGTH + 1,
        maxLength: IDEMPOTENCY_KEY_MAX_LENGTH + 16,
      })
      .map((characters) => characters.join(''));

    fc.assert(
      fc.property(tooLongKeyArbitrary, (key) => {
        expect(parseIdempotencyKeyHeader(key)).toEqual({ kind: 'invalid' });
      }),
      propertyOptions,
    );
  });

  it('rejects values containing a character outside the allowed charset', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom(...IDEMPOTENCY_KEY_ALLOWED_CHARACTERS), {
            minLength: 1,
            maxLength: 24,
          })
          .map((characters) => characters.join('')),
        fc
          .array(fc.constantFrom(...IDEMPOTENCY_KEY_ALLOWED_CHARACTERS), {
            minLength: 1,
            maxLength: 24,
          })
          .map((characters) => characters.join('')),
        fc.constantFrom('!', '?', '#', ',', '\n', ' ', '"'),
        (left, right, forbiddenCharacter) => {
          const value = `${left}${forbiddenCharacter}${right}`;
          expect(parseIdempotencyKeyHeader(value)).toEqual({ kind: 'invalid' });
        },
      ),
      propertyOptions,
    );
  });
});
