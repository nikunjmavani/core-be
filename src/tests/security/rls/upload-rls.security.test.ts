import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import { sql } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

describe('Security: Upload RLS', () => {
  beforeAll(async () => {
    await sql`GRANT core_be_app TO core`.catch(() => undefined);
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('should hide other tenants org-scoped uploads when app.current_organization_id is set', async () => {
    const rlsRows = await sql<{ relrowsecurity: boolean }[]>`
      SELECT c.relrowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'upload' AND c.relname = 'uploads'
    `;
    expect(
      rlsRows[0]?.relrowsecurity,
      'Apply migrations including 20260517000001_upload_rls.sql',
    ).toBe(true);

    const ownerA = await createTestUser();
    const ownerB = await createTestUser();
    const organizationA = await createTestOrganization({ ownerUserId: ownerA.id });
    const organizationB = await createTestOrganization({ ownerUserId: ownerB.id });

    const uploadPublicIdA = generatePublicId('upload');
    const uploadPublicIdB = generatePublicId('upload');

    await database.insert(uploads).values({
      public_id: uploadPublicIdA,
      user_id: ownerA.id,
      organization_id: organizationA.id,
      file_name: 'logo-a.png',
      file_key: 'organization-logos/org-a/logo.png',
      mime_type: 'image/png',
      file_size: 1024,
      storage_provider: 's3',
      bucket: 'test-bucket',
      status: 'PENDING',
    });
    await database.insert(uploads).values({
      public_id: uploadPublicIdB,
      user_id: ownerB.id,
      organization_id: organizationB.id,
      file_name: 'logo-b.png',
      file_key: 'organization-logos/org-b/logo.png',
      mime_type: 'image/png',
      file_size: 1024,
      storage_provider: 's3',
      bucket: 'test-bucket',
      status: 'PENDING',
    });

    const visibleForA = await database.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`SET LOCAL ROLE core_be_app`);
      await transaction.execute(
        drizzleSql`SELECT set_config('app.current_organization_id', ${organizationA.public_id}, true)`,
      );
      return transaction
        .select()
        .from(uploads)
        .where(eq(uploads.organization_id, organizationA.id));
    });

    expect(visibleForA).toHaveLength(1);
    expect(visibleForA[0]?.public_id).toBe(uploadPublicIdA);

    const crossTenantAttempt = await database.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`SET LOCAL ROLE core_be_app`);
      await transaction.execute(
        drizzleSql`SELECT set_config('app.current_organization_id', ${organizationA.public_id}, true)`,
      );
      return transaction
        .select()
        .from(uploads)
        .where(eq(uploads.organization_id, organizationB.id));
    });

    expect(crossTenantAttempt).toHaveLength(0);
  });
});
