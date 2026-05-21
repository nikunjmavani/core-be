import { sql as drizzleSql } from 'drizzle-orm';
import { sql } from '@/infrastructure/database/connection.js';
import { database } from '@/infrastructure/database/connection.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import {
  createMembership,
  createRoleWithPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { notifications } from '@/domains/notify/sub-domains/notification/notification.schema.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { organization_settings } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.schema.js';
import { organization_notification_policies } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.schema.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';

import {
  EXPECTED_FORCE_RLS_TABLES,
  forceRlsTableKey as tableKey,
  type ForceRlsTableRef,
} from '@/infrastructure/database/force-rls-tables.constants.js';

export type { ForceRlsTableRef };
export { EXPECTED_FORCE_RLS_TABLES, tableKey };

export type RlsTenantFixture = {
  organizationAPublicId: string;
  organizationBPublicId: string;
  rowIdsByTable: Map<string, { organizationA: number; organizationB: number }>;
};

/** Tables excluded from generic UPDATE/DELETE matrix (policy shape or parent FK setup). */
export const RLS_MATRIX_SKIP_CRUD_TABLES = new Set([
  tableKey('tenancy', 'organizations'),
  tableKey('tenancy', 'member_invitations'),
  tableKey('tenancy', 'role_permissions'),
  tableKey('tenancy', 'organization_settings'),
  tableKey('notify', 'webhook_delivery_attempts'),
  tableKey('auth', 'verification_tokens'),
]);

export async function grantCoreBeAppRoleForTests(): Promise<void> {
  await sql`GRANT core_be_app TO core`.catch(() => undefined);
}

export async function listForceRlsTablesFromDatabase(): Promise<ForceRlsTableRef[]> {
  const rows = await sql<{ schema_name: string; table_name: string }[]>`
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND c.relforcerowsecurity = true
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname
  `;
  return rows.map((row) => ({ schemaName: row.schema_name, tableName: row.table_name }));
}

export async function isForceRlsEnabled(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await sql<{ relforcerowsecurity: boolean }[]>`
    SELECT c.relforcerowsecurity
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schemaName} AND c.relname = ${tableName}
  `;
  return rows[0]?.relforcerowsecurity === true;
}

export async function executeAsCoreBeAppTenant<T>(
  organizationPublicId: string | null,
  callback: (transaction: typeof database) => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(drizzleSql`SET LOCAL ROLE core_be_app`);
    const tenantValue = organizationPublicId ?? '';
    await transaction.execute(
      drizzleSql`SELECT set_config('app.current_organization_id', ${tenantValue}, true)`,
    );
    return callback(transaction as unknown as typeof database);
  });
}

async function queryCountInTransaction(
  transaction: typeof database,
  schemaName: string,
  tableName: string,
): Promise<number> {
  const qualified = `"${schemaName}"."${tableName}"`;
  const result = await transaction.execute(
    drizzleSql.raw(`SELECT count(*)::int AS count FROM ${qualified}`),
  );
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: { count: number }[] }).rows ?? []);
  return Number(rows[0]?.count ?? 0);
}

export async function countRowsAsTenant(
  schemaName: string,
  tableName: string,
  organizationPublicId: string | null,
): Promise<number> {
  return executeAsCoreBeAppTenant(organizationPublicId, async (transaction) =>
    queryCountInTransaction(transaction, schemaName, tableName),
  );
}

export async function updateRowAsTenant(
  schemaName: string,
  tableName: string,
  rowId: number,
  organizationPublicId: string,
): Promise<number> {
  const qualified = `"${schemaName}"."${tableName}"`;
  return executeAsCoreBeAppTenant(organizationPublicId, async (transaction) => {
    const result = await transaction.execute(
      drizzleSql.raw(`UPDATE ${qualified} SET id = id WHERE id = ${rowId}`),
    );
    return Number((result as { rowCount?: number }).rowCount ?? 0);
  });
}

export async function deleteRowAsTenant(
  schemaName: string,
  tableName: string,
  rowId: number,
  organizationPublicId: string,
): Promise<number> {
  const qualified = `"${schemaName}"."${tableName}"`;
  return executeAsCoreBeAppTenant(organizationPublicId, async (transaction) => {
    const result = await transaction.execute(
      drizzleSql.raw(`DELETE FROM ${qualified} WHERE id = ${rowId}`),
    );
    return Number((result as { rowCount?: number }).rowCount ?? 0);
  });
}

export async function seedRlsMatrixFixtures(): Promise<RlsTenantFixture> {
  const ownerA = await createTestUser();
  const ownerB = await createTestUser();
  const organizationA = await createTestOrganization({ ownerUserId: ownerA.id });
  const organizationB = await createTestOrganization({ ownerUserId: ownerB.id });
  const plan = await createTestPlan();
  const periodStart = new Date();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const roleA = await createRoleWithPermissions({
    organizationId: organizationA.id,
    permissionCodes: [],
    createdByUserId: ownerA.id,
  });
  const roleB = await createRoleWithPermissions({
    organizationId: organizationB.id,
    permissionCodes: [],
    createdByUserId: ownerB.id,
  });
  const membershipA = await createMembership({
    userId: ownerA.id,
    organizationId: organizationA.id,
    roleId: roleA.id,
  });
  const membershipB = await createMembership({
    userId: ownerB.id,
    organizationId: organizationB.id,
    roleId: roleB.id,
  });

  const rowIdsByTable = new Map<string, { organizationA: number; organizationB: number }>();

  rowIdsByTable.set(tableKey('tenancy', 'organizations'), {
    organizationA: organizationA.id,
    organizationB: organizationB.id,
  });
  rowIdsByTable.set(tableKey('tenancy', 'memberships'), {
    organizationA: membershipA.id,
    organizationB: membershipB.id,
  });
  rowIdsByTable.set(tableKey('tenancy', 'roles'), {
    organizationA: roleA.id,
    organizationB: roleB.id,
  });

  await database.insert(organization_settings).values({ organization_id: organizationA.id });
  await database.insert(organization_settings).values({ organization_id: organizationB.id });

  const [policyA] = await database
    .insert(organization_notification_policies)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationA.id,
      notification_type: 'billing',
      channel: 'EMAIL',
    })
    .returning();
  const [policyB] = await database
    .insert(organization_notification_policies)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationB.id,
      notification_type: 'billing',
      channel: 'EMAIL',
    })
    .returning();
  rowIdsByTable.set(tableKey('tenancy', 'organization_notification_policies'), {
    organizationA: policyA!.id,
    organizationB: policyB!.id,
  });

  const [apiKeyA] = await database
    .insert(api_keys)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationA.id,
      name: 'key-a',
      key_hash: 'hash-a',
      key_prefix: 'prefix-a',
      created_by_user_id: ownerA.id,
    })
    .returning();
  const [apiKeyB] = await database
    .insert(api_keys)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationB.id,
      name: 'key-b',
      key_hash: 'hash-b',
      key_prefix: 'prefix-b',
      created_by_user_id: ownerB.id,
    })
    .returning();
  rowIdsByTable.set(tableKey('tenancy', 'api_keys'), {
    organizationA: apiKeyA!.id,
    organizationB: apiKeyB!.id,
  });

  const webhookA = await createTestWebhook({ organizationId: organizationA.id });
  const webhookB = await createTestWebhook({ organizationId: organizationB.id });
  rowIdsByTable.set(tableKey('notify', 'webhooks'), {
    organizationA: webhookA.id,
    organizationB: webhookB.id,
  });

  const [notificationA] = await database
    .insert(notifications)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationA.id,
      user_id: ownerA.id,
      type: 'TEST',
      title: 'A',
      message: 'body',
    })
    .returning();
  const [notificationB] = await database
    .insert(notifications)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationB.id,
      user_id: ownerB.id,
      type: 'TEST',
      title: 'B',
      message: 'body',
    })
    .returning();
  rowIdsByTable.set(tableKey('notify', 'notifications'), {
    organizationA: notificationA!.id,
    organizationB: notificationB!.id,
  });

  const [subscriptionA] = await database
    .insert(subscriptions)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationA.id,
      plan_id: plan.id,
      billing_cycle: 'MONTHLY',
      status: 'ACTIVE',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
    .returning();
  const [subscriptionB] = await database
    .insert(subscriptions)
    .values({
      public_id: generatePublicId(),
      organization_id: organizationB.id,
      plan_id: plan.id,
      billing_cycle: 'MONTHLY',
      status: 'ACTIVE',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
    .returning();
  rowIdsByTable.set(tableKey('billing', 'subscriptions'), {
    organizationA: subscriptionA!.id,
    organizationB: subscriptionB!.id,
  });

  const [auditA] = await database
    .insert(logs)
    .values({
      organization_id: organizationA.id,
      actor_user_id: ownerA.id,
      action: 'test.action',
      resource_type: 'organization',
    })
    .returning();
  const [auditB] = await database
    .insert(logs)
    .values({
      organization_id: organizationB.id,
      actor_user_id: ownerB.id,
      action: 'test.action',
      resource_type: 'organization',
    })
    .returning();
  rowIdsByTable.set(tableKey('audit', 'logs'), {
    organizationA: auditA!.id,
    organizationB: auditB!.id,
  });

  const [uploadA] = await database
    .insert(uploads)
    .values({
      public_id: generatePublicId(),
      user_id: ownerA.id,
      organization_id: organizationA.id,
      file_name: 'a.png',
      file_key: 'org-a/a.png',
      mime_type: 'image/png',
      file_size: 100,
      storage_provider: 's3',
      bucket: 'test',
      status: 'PENDING',
    })
    .returning();
  const [uploadB] = await database
    .insert(uploads)
    .values({
      public_id: generatePublicId(),
      user_id: ownerB.id,
      organization_id: organizationB.id,
      file_name: 'b.png',
      file_key: 'org-b/b.png',
      mime_type: 'image/png',
      file_size: 100,
      storage_provider: 's3',
      bucket: 'test',
      status: 'PENDING',
    })
    .returning();
  rowIdsByTable.set(tableKey('upload', 'uploads'), {
    organizationA: uploadA!.id,
    organizationB: uploadB!.id,
  });

  return {
    organizationAPublicId: organizationA.public_id,
    organizationBPublicId: organizationB.public_id,
    rowIdsByTable,
  };
}
