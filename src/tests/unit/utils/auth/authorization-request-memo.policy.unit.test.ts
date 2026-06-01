import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const authorizationUtilPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../shared/utils/auth/authorization.util.ts',
);

describe('authorization.util request memo policy', () => {
  it('memoizes organization permission resolution with a WeakMap keyed by FastifyRequest', () => {
    const source = readFileSync(authorizationUtilPath, 'utf8');
    expect(source).toContain('new WeakMap<');
    expect(source).toContain('FastifyRequest');
    expect(source).not.toContain('_organizationPermissionResolveMemo');
  });
});
