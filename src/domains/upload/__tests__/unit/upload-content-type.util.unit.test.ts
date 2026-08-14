import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CONTENT_TYPE_TO_EXTENSIONS,
  getAllowedContentTypesForPurpose,
  getAllowedExtensionsForContentType,
  getCanonicalExtensionForContentType,
} from '@/domains/upload/utils/upload-content-type.util.js';
import { UPLOAD_PURPOSES, UPLOAD_PURPOSE_CONFIG } from '@/domains/upload/upload.constants.js';
import { SVG_CONTENT_TYPE } from '@/domains/upload/utils/upload-svg.util.js';

// The util reads `env.UPLOAD_ALLOW_SVG` at call time, so a mutable mock lets one file
// exercise both sides of the flag without re-importing the module under test.
const { environmentMock } = vi.hoisted(() => ({ environmentMock: { UPLOAD_ALLOW_SVG: false } }));
vi.mock('@/shared/config/env.config.js', () => ({
  env: environmentMock,
  getEnv: () => environmentMock,
}));

/**
 * Direct coverage for the extension/content-type policy module. All four exports were
 * previously proven only transitively, through `validateCreateUpload` — including
 * {@link CONTENT_TYPE_TO_EXTENSIONS}, the map that makes `evil.png.php` fail. Testing the
 * map here means a change to it is caught at its source rather than as a surprising
 * validator failure three layers away.
 */
describe('upload-content-type.util', () => {
  beforeEach(() => {
    environmentMock.UPLOAD_ALLOW_SVG = false;
  });

  describe('getAllowedContentTypesForPurpose', () => {
    // One case per purpose: the allowlist is the byte-level security boundary for what a
    // presigned URL will accept, so each purpose asserts its own list rather than a loop.
    it('avatar allows only the three raster image types', () => {
      expect(getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR)).toEqual([
        'image/png',
        'image/jpeg',
        'image/webp',
      ]);
    });

    it('organization-logo allows only the three raster image types', () => {
      expect(getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.ORGANIZATION_LOGO)).toEqual([
        'image/png',
        'image/jpeg',
        'image/webp',
      ]);
    });

    it('user-file additionally allows application/pdf', () => {
      const allowed = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.USER_FILE);
      expect(allowed).toContain('application/pdf');
      expect(allowed).toEqual(UPLOAD_PURPOSE_CONFIG[UPLOAD_PURPOSES.USER_FILE].allowedTypes);
    });

    it('organization-file additionally allows application/pdf', () => {
      const allowed = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.ORGANIZATION_FILE);
      expect(allowed).toContain('application/pdf');
      expect(allowed).toEqual(
        UPLOAD_PURPOSE_CONFIG[UPLOAD_PURPOSES.ORGANIZATION_FILE].allowedTypes,
      );
    });

    // sec-UP6: SVG is script-bearing, so it is opt-in via UPLOAD_ALLOW_SVG and must never
    // appear for a purpose that has no image type to begin with.
    it('appends image/svg+xml only when UPLOAD_ALLOW_SVG is enabled', () => {
      expect(getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR)).not.toContain(
        SVG_CONTENT_TYPE,
      );

      environmentMock.UPLOAD_ALLOW_SVG = true;
      expect(getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR)).toContain(SVG_CONTENT_TYPE);
    });
  });

  describe('getAllowedExtensionsForContentType', () => {
    it('returns the extension list for a known content type', () => {
      expect(getAllowedExtensionsForContentType('image/png')).toEqual(['.png']);
    });

    // The alias pair is why `photo.jpeg` and `photo.jpg` both validate against image/jpeg.
    it('returns both .jpg and .jpeg for image/jpeg, canonical first', () => {
      expect(getAllowedExtensionsForContentType('image/jpeg')).toEqual(['.jpg', '.jpeg']);
    });

    // Empty (not undefined) is the contract the validator depends on: an unknown type must
    // fail the `allowedExtensions.includes(...)` check rather than throw on a null lookup.
    it('returns an empty list for an unknown content type', () => {
      expect(getAllowedExtensionsForContentType('application/x-msdownload')).toEqual([]);
    });

    /**
     * `CONTENT_TYPE_TO_EXTENSIONS` is a plain object literal, so an inherited key like
     * `constructor` resolves to an `Object.prototype` member instead of falling through to
     * `?? []`. That is harmless today — the validator checks the per-purpose allowlist before
     * it ever reaches this lookup — but the canonical accessor is what feeds the generated S3
     * key, so pin that a probe can never turn into a usable extension.
     */
    it('never yields a usable extension for inherited Object keys', () => {
      expect(getCanonicalExtensionForContentType('constructor')).toBe('');
      expect(getCanonicalExtensionForContentType('toString')).toBe('');
    });
  });

  describe('getCanonicalExtensionForContentType', () => {
    it('returns the first (canonical) extension for a mapped type', () => {
      expect(getCanonicalExtensionForContentType('image/jpeg')).toBe('.jpg');
      expect(getCanonicalExtensionForContentType('application/pdf')).toBe('.pdf');
    });

    it('returns an empty string for an unmapped type', () => {
      expect(getCanonicalExtensionForContentType('text/html')).toBe('');
    });
  });

  /**
   * Every content type any purpose can allow must have an entry in the extension map —
   * otherwise `getCanonicalExtensionForContentType` returns '' and the generated S3 key
   * loses its extension while the validator silently accepts any filename extension.
   */
  it('CONTENT_TYPE_TO_EXTENSIONS covers every content type reachable from a purpose', () => {
    environmentMock.UPLOAD_ALLOW_SVG = true;
    const reachable = new Set(
      Object.values(UPLOAD_PURPOSES).flatMap((purpose) => [
        ...getAllowedContentTypesForPurpose(purpose),
      ]),
    );

    for (const contentType of reachable) {
      expect(Object.keys(CONTENT_TYPE_TO_EXTENSIONS)).toContain(contentType);
      expect(getCanonicalExtensionForContentType(contentType)).toMatch(/^\.[a-z0-9]+$/);
    }
  });
});
