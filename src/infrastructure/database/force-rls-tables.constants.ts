export type ForceRlsTableRef = {
  schemaName: string;
  tableName: string;
};

/** Tables with FORCE ROW LEVEL SECURITY enabled (tenant isolation or retention bypass). */
export const EXPECTED_FORCE_RLS_TABLES: ForceRlsTableRef[] = [
  { schemaName: 'tenancy', tableName: 'organizations' },
  { schemaName: 'tenancy', tableName: 'memberships' },
  { schemaName: 'tenancy', tableName: 'member_invitations' },
  { schemaName: 'tenancy', tableName: 'roles' },
  { schemaName: 'tenancy', tableName: 'role_permissions' },
  { schemaName: 'tenancy', tableName: 'organization_settings' },
  { schemaName: 'tenancy', tableName: 'organization_notification_policies' },
  { schemaName: 'tenancy', tableName: 'api_keys' },
  { schemaName: 'billing', tableName: 'subscriptions' },
  { schemaName: 'notify', tableName: 'webhooks' },
  { schemaName: 'notify', tableName: 'webhook_delivery_attempts' },
  { schemaName: 'notify', tableName: 'notifications' },
  { schemaName: 'audit', tableName: 'logs' },
  { schemaName: 'auth', tableName: 'verification_tokens' },
  { schemaName: 'upload', tableName: 'uploads' },
];

const FORCE_RLS_TABLE_KEYS = new Set(
  EXPECTED_FORCE_RLS_TABLES.map((table) => `${table.schemaName}.${table.tableName}`),
);

export function forceRlsTableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

export function isForceRlsTable(schemaName: string, tableName: string): boolean {
  return FORCE_RLS_TABLE_KEYS.has(forceRlsTableKey(schemaName, tableName));
}
