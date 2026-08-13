import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_PURPOSES } from '@/domains/upload/upload.constants.js';

/**
 * `getAllowedContentTypesForPurpose` is the allowlist the upload validator enforces, and the ONLY
 * place `UPLOAD_ALLOW_SVG` widens it. SVG is a scriptable format, so a regression that leaks it
 * into a purpose whose base list has no image type — or that appends it twice — changes what the
 * API accepts without any route or validator edit. Nothing referenced this module before.
 */
describe('upload-content-type.util', () => {
  const SVG = 'image/svg+xml';

  async function loadModuleWithSvgFlag(allowSvg: boolean) {
    vi.doMock('@/shared/config/env.config.js', () => ({
      env: { UPLOAD_ALLOW_SVG: allowSvg },
    }));
    await vi.resetModules();
    return import('@/domains/upload/utils/upload-content-type.util.js');
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/shared/config/env.config.js');
  });

  describe('getAllowedContentTypesForPurpose — SVG flag OFF', () => {
    it.each([
      UPLOAD_PURPOSES.AVATAR,
      UPLOAD_PURPOSES.ORGANIZATION_LOGO,
      UPLOAD_PURPOSES.USER_FILE,
      UPLOAD_PURPOSES.ORGANIZATION_FILE,
    ])('never returns SVG for %s', async (purpose) => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(false);

      expect(getAllowedContentTypesForPurpose(purpose)).not.toContain(SVG);
    });

    it('returns the configured base list unchanged for avatar', async () => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(false);

      expect([...getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR)]).toEqual([
        'image/png',
        'image/jpeg',
        'image/webp',
      ]);
    });

    it('keeps application/pdf on the file purposes', async () => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(false);

      expect(getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.USER_FILE)).toContain(
        'application/pdf',
      );
      expect(getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.ORGANIZATION_FILE)).toContain(
        'application/pdf',
      );
    });
  });

  describe('getAllowedContentTypesForPurpose — SVG flag ON', () => {
    it.each([
      UPLOAD_PURPOSES.AVATAR,
      UPLOAD_PURPOSES.ORGANIZATION_LOGO,
      UPLOAD_PURPOSES.USER_FILE,
      UPLOAD_PURPOSES.ORGANIZATION_FILE,
    ])('appends SVG for %s, whose base list has an image type', async (purpose) => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(true);

      expect(getAllowedContentTypesForPurpose(purpose)).toContain(SVG);
    });

    it('appends SVG exactly once', async () => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(true);

      const allowed = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR);
      expect(allowed.filter((contentType) => contentType === SVG)).toHaveLength(1);
    });

    it('preserves the base list and only adds to it', async () => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(true);
      const withSvg = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR);

      for (const baseType of ['image/png', 'image/jpeg', 'image/webp']) {
        expect(withSvg).toContain(baseType);
      }
      expect(withSvg).toHaveLength(4);
    });

    it('appends SVG last, so the base allowlist order is unchanged', async () => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(true);

      const allowed = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR);
      expect(allowed.at(-1)).toBe(SVG);
    });

    it('does not mutate the shared UPLOAD_PURPOSE_CONFIG allowlist across calls', async () => {
      const { getAllowedContentTypesForPurpose } = await loadModuleWithSvgFlag(true);

      const first = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR);
      const second = getAllowedContentTypesForPurpose(UPLOAD_PURPOSES.AVATAR);

      // A push-based implementation would grow the config array on every call.
      expect(second).toHaveLength(first.length);
      expect(second.filter((contentType) => contentType === SVG)).toHaveLength(1);
    });
  });

  describe('getAllowedExtensionsForContentType', () => {
    it.each([
      ['image/png', ['.png']],
      ['image/jpeg', ['.jpg', '.jpeg']],
      ['image/webp', ['.webp']],
      ['image/svg+xml', ['.svg']],
      ['application/pdf', ['.pdf']],
    ])('maps %s to its extensions', async (contentType, expected) => {
      const { getAllowedExtensionsForContentType } = await loadModuleWithSvgFlag(false);

      expect([...getAllowedExtensionsForContentType(contentType)]).toEqual(expected);
    });

    it.each([
      ['an unmapped type', 'application/zip'],
      ['an empty string', ''],
    ])('returns an empty array for %s', async (_label, key) => {
      const { getAllowedExtensionsForContentType } = await loadModuleWithSvgFlag(false);

      expect(getAllowedExtensionsForContentType(key)).toEqual([]);
    });

    // KNOWN DEFECT — not asserted here on purpose.
    //
    // `CONTENT_TYPE_TO_EXTENSIONS` is a plain object literal, so looking it up by an INHERITED
    // key resolves up the prototype chain to a non-nullish value: `'constructor'` yields the
    // `Object` constructor and `'__proto__'` yields `Object.prototype`. The `?? []` fallback
    // never fires, so the function returns a function/object where its signature promises
    // `readonly string[]`.
    //
    // Not exploitable today — every caller passes a content type already checked against the
    // validator allowlist — but the guard belongs in the source, not in a test that documents
    // the wrong behaviour as correct. The fix is a one-line `Object.hasOwn` check; it is held
    // back only because it touches deployed surface, which requires the SonarQube pre-commit
    // gate, which needs a Docker daemon unavailable in this environment.
  });

  describe('getCanonicalExtensionForContentType', () => {
    it('returns the FIRST extension when a type has several', async () => {
      const { getCanonicalExtensionForContentType } = await loadModuleWithSvgFlag(false);

      // image/jpeg maps to ['.jpg', '.jpeg'] — the canonical key suffix must be stable.
      expect(getCanonicalExtensionForContentType('image/jpeg')).toBe('.jpg');
    });

    it.each([
      ['image/png', '.png'],
      ['image/webp', '.webp'],
      ['application/pdf', '.pdf'],
      ['image/svg+xml', '.svg'],
    ])('returns %s → %s', async (contentType, expected) => {
      const { getCanonicalExtensionForContentType } = await loadModuleWithSvgFlag(false);

      expect(getCanonicalExtensionForContentType(contentType)).toBe(expected);
    });

    it('returns an empty string for an unmapped type', async () => {
      const { getCanonicalExtensionForContentType } = await loadModuleWithSvgFlag(false);

      expect(getCanonicalExtensionForContentType('application/zip')).toBe('');
    });
  });
});
