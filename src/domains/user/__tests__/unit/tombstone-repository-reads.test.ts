/** Cross-domain read-path invariant (tenancy, billing, notify sub-domains). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const thisDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(thisDirectoryPath, '..', '..', '..', '..', '..');

const TOMBSTONE_REPOSITORY_PATHS = [
  'src/domains/user/user.repository.ts',
  'src/domains/tenancy/sub-domains/organization/organization.repository.ts',
  'src/domains/tenancy/sub-domains/membership/membership.repository.ts',
  'src/domains/tenancy/sub-domains/member-roles/member-role.repository.ts',
  'src/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.repository.ts',
  'src/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.repository.ts',
  'src/domains/notify/sub-domains/webhook/webhook.repository.ts',
  'src/domains/upload/upload.repository.ts',
] as const;

describe('tombstone repository read filters', () => {
  it('repositories filter deleted_at on read paths', () => {
    for (const relativePath of TOMBSTONE_REPOSITORY_PATHS) {
      const absolutePath = path.join(projectRoot, relativePath);
      const source = readFileSync(absolutePath, 'utf8');
      expect(source, relativePath).toMatch(/isNull\([^)]*\.deleted_at\)/);
    }
  });
});
