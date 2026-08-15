import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  buildOrganizationLogoKeyPrefix,
  buildPendingObjectKey,
  buildUserAvatarKeyPrefix,
  stripPendingObjectKeyPrefix,
  UPLOAD_PENDING_KEY_PREFIX,
  UPLOAD_PURPOSES,
  type UploadPurpose,
} from '@/domains/upload/upload.constants.js';
import {
  CONTENT_TYPE_TO_EXTENSIONS,
  getAllowedContentTypesForPurpose,
  getAllowedExtensionsForContentType,
  getCanonicalExtensionForContentType,
} from '@/domains/upload/utils/upload-content-type.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

/**
 * Layer 2 (property) for the two rule systems the upload domain rests on: the
 * `pending/<finalKey>` namespace split (the property that separates an unconfirmed object from a
 * servable one) and the purpose→content-type→extension map that makes `evil.png.php` fail. The
 * example suite pins single keys; these pin the algebra — for any key, for every purpose, for any
 * number of stacked prefixes.
 */

/** Object keys as produced by the presign path: printable, non-empty, no leading slash. */
const objectKey = fc
  .stringMatching(/^[a-zA-Z0-9._/-]{1,120}$/)
  .filter((key) => !key.startsWith('/'));

const publicIdSuffix = fc.stringMatching(/^[a-z0-9]{21}$/);
const purposes = Object.values(UPLOAD_PURPOSES) as UploadPurpose[];

describe('pending-key namespace (property)', () => {
  it('strip(build(key)) round-trips every key, and build never returns the input unchanged', () => {
    fc.assert(
      fc.property(objectKey, (key) => {
        const pending = buildPendingObjectKey(key);
        expect(stripPendingObjectKeyPrefix(pending)).toBe(key);
        // pending and final must NEVER coincide — a key equal to its own pending form would
        // make an unconfirmed object servable.
        expect(pending).not.toBe(key);
      }),
      propertyOptions,
    );
  });

  it('strip removes at most ONE prefix, so a doubled prefix stays visibly pending', () => {
    fc.assert(
      fc.property(objectKey, fc.integer({ min: 2, max: 5 }), (key, stack) => {
        let stacked = key;
        for (let i = 0; i < stack; i += 1) stacked = buildPendingObjectKey(stacked);
        const afterOneStrip = stripPendingObjectKeyPrefix(stacked);
        // One strip peels exactly one layer — a strip that looped to a fixpoint would let
        // `pending/pending/x` collapse into a valid-looking final key in a single call.
        expect(afterOneStrip.startsWith(UPLOAD_PENDING_KEY_PREFIX)).toBe(true);
      }),
      propertyOptions,
    );
  });

  it('strip is the identity for any key that does not carry the prefix', () => {
    fc.assert(
      fc.property(
        objectKey.filter((key) => !key.startsWith(UPLOAD_PENDING_KEY_PREFIX)),
        (key) => {
          expect(stripPendingObjectKeyPrefix(key)).toBe(key);
        },
      ),
      propertyOptions,
    );
  });

  it('user-avatar and organization-logo prefixes never collide for any id pair', () => {
    fc.assert(
      fc.property(publicIdSuffix, publicIdSuffix, (userSuffix, organizationSuffix) => {
        const avatarPrefix = buildUserAvatarKeyPrefix(`usr_${userSuffix}`);
        const logoPrefix = buildOrganizationLogoKeyPrefix(`org_${organizationSuffix}`);
        // Owner-prefix guards on the attach routes rely on these namespaces being disjoint:
        // a key under one prefix must be unclassifiable as the other.
        expect(avatarPrefix.startsWith(logoPrefix)).toBe(false);
        expect(logoPrefix.startsWith(avatarPrefix)).toBe(false);
      }),
      propertyOptions,
    );
  });
});

describe('content-type map (property)', () => {
  it('every content type reachable from ANY purpose has at least one extension, and its canonical extension is among them', () => {
    fc.assert(
      fc.property(fc.constantFrom(...purposes), (purpose) => {
        for (const contentType of getAllowedContentTypesForPurpose(purpose)) {
          const extensions = getAllowedExtensionsForContentType(contentType);
          // A purpose gaining a MIME type with no extension mapping would make every upload
          // of that type fail the extension check — this is the self-policing invariant.
          expect(extensions.length).toBeGreaterThan(0);
          expect(extensions).toContain(getCanonicalExtensionForContentType(contentType));
        }
      }),
      propertyOptions,
    );
  });

  it('never yields extensions for inherited Object keys or arbitrary unknown types', () => {
    const inheritedKeys = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'];
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...inheritedKeys),
          fc
            .stringMatching(/^[a-z]+\/[a-z0-9.+-]+$/)
            .filter((type) => !(type in CONTENT_TYPE_TO_EXTENSIONS)),
        ),
        (unknownType) => {
          // A prototype-pollution probe (`constructor`, `__proto__`) against the lookup map
          // must behave exactly like any unknown MIME type: no usable extension.
          expect(getAllowedExtensionsForContentType(unknownType)).toHaveLength(0);
        },
      ),
      propertyOptions,
    );
  });

  it('extension sets of distinct content types never share an extension across one purpose', () => {
    fc.assert(
      fc.property(fc.constantFrom(...purposes), (purpose) => {
        const seen = new Map<string, string>();
        for (const contentType of getAllowedContentTypesForPurpose(purpose)) {
          for (const extension of getAllowedExtensionsForContentType(contentType)) {
            const previous = seen.get(extension);
            // One extension mapping to two MIME types within a purpose would make the
            // filename↔content-type consistency check ambiguous.
            if (previous !== undefined) {
              expect(previous).toBe(contentType);
            }
            seen.set(extension, contentType);
          }
        }
      }),
      propertyOptions,
    );
  });
});
