import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const permissionCacheServicePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../permission-cache.service.ts',
);

describe('permission-cache.service policy', () => {
  it('does not use Redis SCAN for organization invalidation', () => {
    const source = readFileSync(permissionCacheServicePath, 'utf8');
    expect(source).not.toMatch(/\bscan\s*\(/i);
    // Org-wide invalidation stays O(1): a single INCR (+EXPIRE) on the version key via Lua,
    // never a SCAN sweep. The version bump is centralized in bumpOrganizationCacheVersion.
    expect(source).toContain("redis.call('INCR', KEYS[1])");
    expect(source).toContain('buildOrganizationVersionKey(organizationId)');
  });

  it('includes organization cache version in permission keys', () => {
    const source = readFileSync(permissionCacheServicePath, 'utf8');
    expect(source).toContain('getOrganizationCacheVersion');
    expect(source).toContain('perm:org');
  });
});
