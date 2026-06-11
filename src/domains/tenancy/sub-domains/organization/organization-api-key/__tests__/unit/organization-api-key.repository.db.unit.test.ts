import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';
import { OrganizationApiKeyRepository } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.repository.js';

describe('OrganizationApiKeyRepository.touchLastUsedAt (audit-#8 throttle)', () => {
  const repository = new OrganizationApiKeyRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  async function seedApiKey(organizationId: number) {
    const public_id = generatePublicId();
    await database.insert(api_keys).values({
      public_id,
      organization_id: organizationId,
      name: 'touch-throttle-test',
      key_hash: 'hash',
      key_prefix: 'ak_test',
    });
    return public_id;
  }

  async function readLastUsedAt(public_id: string) {
    const rows = await database
      .select({ last_used_at: api_keys.last_used_at })
      .from(api_keys)
      .where(eq(api_keys.public_id, public_id));
    return rows[0]!.last_used_at;
  }

  it('writes last_used_at on the first touch but is a no-op on an immediate second touch', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const publicId = await seedApiKey(organization.id);

    await repository.touchLastUsedAt(publicId);
    const first = await readLastUsedAt(publicId);
    expect(first).not.toBeNull();

    // A second touch within the ~1-minute bucket must not rewrite the row.
    await repository.touchLastUsedAt(publicId);
    const second = await readLastUsedAt(publicId);
    expect(second?.toISOString()).toBe(first?.toISOString());
  });

  it('writes again once last_used_at is older than the throttle window', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const publicId = await seedApiKey(organization.id);

    // Backdate last_used_at well past the 1-minute bucket.
    const stale = new Date(Date.now() - 5 * 60 * 1000);
    await database
      .update(api_keys)
      .set({ last_used_at: stale })
      .where(eq(api_keys.public_id, publicId));

    await repository.touchLastUsedAt(publicId);
    const updated = await readLastUsedAt(publicId);
    expect(updated!.getTime()).toBeGreaterThan(stale.getTime());
  });
});
