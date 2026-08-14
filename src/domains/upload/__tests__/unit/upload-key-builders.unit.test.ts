import { describe, it, expect } from 'vitest';
import {
  UPLOAD_PENDING_KEY_PREFIX,
  UPLOAD_PURPOSES,
  UPLOAD_PURPOSE_CONFIG,
  buildOrganizationLogoKeyPrefix,
  buildPendingObjectKey,
  buildUserAvatarKeyPrefix,
  stripPendingObjectKeyPrefix,
} from '@/domains/upload/upload.constants.js';

/**
 * The four storage-key builders were referenced by no test file at all, even though the
 * pending↔final key split is the property the whole domain rests on: the client holds a
 * presigned URL for `pending/<key>` only, and confirm republishes the verified bytes to
 * `<key>`. If `buildPendingObjectKey` and `stripPendingObjectKeyPrefix` ever stop being
 * exact inverses, the served object becomes writable through a still-valid upload URL.
 *
 * Asserted here directly rather than as a side effect inside service tests, so the property
 * survives any future rewrite of those services.
 */
describe('upload storage key builders', () => {
  const USER_PUBLIC_ID = 'user_abcdefghijklmnopqrstu';
  const ORGANIZATION_PUBLIC_ID = 'org_abcdefghijklmnopqrstu';
  const FINAL_KEY = `avatars/${USER_PUBLIC_ID}/9f2c1a.png`;

  describe('buildPendingObjectKey / stripPendingObjectKeyPrefix', () => {
    it('buildPendingObjectKey namespaces a final key under the pending prefix', () => {
      expect(buildPendingObjectKey(FINAL_KEY)).toBe(`${UPLOAD_PENDING_KEY_PREFIX}${FINAL_KEY}`);
    });

    // The security-relevant half: the pending key must never equal the servable key.
    it('the pending key is never equal to the final key', () => {
      expect(buildPendingObjectKey(FINAL_KEY)).not.toBe(FINAL_KEY);
    });

    it('strip(build(key)) round-trips back to the original final key', () => {
      expect(stripPendingObjectKeyPrefix(buildPendingObjectKey(FINAL_KEY))).toBe(FINAL_KEY);
    });

    it('stripPendingObjectKeyPrefix leaves a key without the prefix untouched', () => {
      expect(stripPendingObjectKeyPrefix(FINAL_KEY)).toBe(FINAL_KEY);
    });

    /**
     * Strip removes exactly one prefix layer. A key that legitimately contains the literal
     * `pending/` deeper in its path must keep it, and a doubly-wrapped key must not collapse
     * to the final key in a single call — otherwise a crafted name could strip its way out of
     * the pending namespace.
     */
    it('stripPendingObjectKeyPrefix removes at most one leading prefix', () => {
      const doubled = buildPendingObjectKey(buildPendingObjectKey(FINAL_KEY));

      expect(stripPendingObjectKeyPrefix(doubled)).toBe(buildPendingObjectKey(FINAL_KEY));
      expect(stripPendingObjectKeyPrefix(`user-files/${UPLOAD_PENDING_KEY_PREFIX}note.pdf`)).toBe(
        `user-files/${UPLOAD_PENDING_KEY_PREFIX}note.pdf`,
      );
    });
  });

  describe('owner-scoped key prefixes', () => {
    /**
     * The attach path binds an object to its owner by key prefix, so these two must stay
     * anchored to the purpose config (not a duplicated string literal) and must end in a
     * slash — without it, `avatars/user_abc` would also prefix-match `avatars/user_abcdef`.
     */
    it('buildUserAvatarKeyPrefix is the avatar purpose prefix plus the user public id', () => {
      const prefix = buildUserAvatarKeyPrefix(USER_PUBLIC_ID);

      expect(prefix).toBe(
        `${UPLOAD_PURPOSE_CONFIG[UPLOAD_PURPOSES.AVATAR].keyPrefix}/${USER_PUBLIC_ID}/`,
      );
      expect(prefix.endsWith('/')).toBe(true);
    });

    it('buildOrganizationLogoKeyPrefix is the logo purpose prefix plus the organization public id', () => {
      const prefix = buildOrganizationLogoKeyPrefix(ORGANIZATION_PUBLIC_ID);

      expect(prefix).toBe(
        `${UPLOAD_PURPOSE_CONFIG[UPLOAD_PURPOSES.ORGANIZATION_LOGO].keyPrefix}/${ORGANIZATION_PUBLIC_ID}/`,
      );
      expect(prefix.endsWith('/')).toBe(true);
    });

    // Cross-scope: a user prefix must never prefix-match an organization key or vice versa.
    it('user and organization prefixes never overlap', () => {
      const userPrefix = buildUserAvatarKeyPrefix(USER_PUBLIC_ID);
      const organizationPrefix = buildOrganizationLogoKeyPrefix(ORGANIZATION_PUBLIC_ID);

      expect(organizationPrefix.startsWith(userPrefix)).toBe(false);
      expect(userPrefix.startsWith(organizationPrefix)).toBe(false);
    });
  });
});
