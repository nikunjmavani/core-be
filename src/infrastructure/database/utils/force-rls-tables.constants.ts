/** Qualified Postgres table reference (`<schemaName>.<tableName>`) used for FORCE-RLS lookups. */
export type ForceRlsTableRef = {
  schemaName: string;
  tableName: string;
};

/**
 * Tables with `FORCE ROW LEVEL SECURITY` enabled (tenant isolation, user-scoped isolation, or
 * retention bypass). This is the **intentional** set: adding or removing a table here must be a
 * deliberate change paired with a migration. The runtime guard
 * {@link diffForceRlsTables} asserts the live database matches this set exactly (no missing, extra,
 * or disabled tables), so the list can no longer silently drift from migration truth (audit #16).
 *
 * @remarks
 * - Includes partitioned parents (`audit.logs`, `notify.notifications`): PostgreSQL records
 *   `relforcerowsecurity` on the parent (`relkind = 'p'`), and the policy cascades to partitions.
 * - Keep alphabetical within each schema for reviewability.
 */
export const EXPECTED_FORCE_RLS_TABLES: ForceRlsTableRef[] = [
  { schemaName: 'audit', tableName: 'dead_letter_jobs' },
  { schemaName: 'audit', tableName: 'logs' },
  { schemaName: 'auth', tableName: 'auth_methods' },
  { schemaName: 'auth', tableName: 'mail_outbox' },
  { schemaName: 'auth', tableName: 'mfa_methods' },
  { schemaName: 'auth', tableName: 'mfa_recovery_codes' },
  { schemaName: 'auth', tableName: 'sessions' },
  { schemaName: 'auth', tableName: 'user_data_exports' },
  { schemaName: 'auth', tableName: 'user_notification_preferences' },
  { schemaName: 'auth', tableName: 'user_settings' },
  { schemaName: 'auth', tableName: 'users' },
  { schemaName: 'auth', tableName: 'verification_tokens' },
  { schemaName: 'auth', tableName: 'webauthn_credentials' },
  { schemaName: 'billing', tableName: 'plans' },
  { schemaName: 'billing', tableName: 'stripe_subscription_tombstones' },
  { schemaName: 'billing', tableName: 'stripe_webhook_events' },
  { schemaName: 'billing', tableName: 'subscriptions' },
  { schemaName: 'notify', tableName: 'notifications' },
  { schemaName: 'notify', tableName: 'webhook_delivery_attempts' },
  { schemaName: 'notify', tableName: 'webhooks' },
  { schemaName: 'tenancy', tableName: 'api_keys' },
  { schemaName: 'tenancy', tableName: 'member_invitations' },
  { schemaName: 'tenancy', tableName: 'memberships' },
  { schemaName: 'tenancy', tableName: 'organization_notification_policies' },
  { schemaName: 'tenancy', tableName: 'organization_settings' },
  { schemaName: 'tenancy', tableName: 'organizations' },
  { schemaName: 'tenancy', tableName: 'permissions' },
  { schemaName: 'tenancy', tableName: 'role_permissions' },
  { schemaName: 'tenancy', tableName: 'roles' },
  { schemaName: 'upload', tableName: 'uploads' },
];

const FORCE_RLS_TABLE_KEYS = new Set(
  EXPECTED_FORCE_RLS_TABLES.map((table) => `${table.schemaName}.${table.tableName}`),
);

/** Canonical `<schema>.<table>` lookup key for the FORCE-RLS set in {@link EXPECTED_FORCE_RLS_TABLES}. */
export function forceRlsTableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

/**
 * Returns true when the given schema/table has `FORCE ROW LEVEL SECURITY` enabled.
 * Worker context wrappers consult this before letting a job touch a tenant-scoped
 * or retention-protected table.
 */
export function isForceRlsTable(schemaName: string, tableName: string): boolean {
  return FORCE_RLS_TABLE_KEYS.has(forceRlsTableKey(schemaName, tableName));
}

/** Drift between the live database FORCE-RLS set and {@link EXPECTED_FORCE_RLS_TABLES}. */
export type ForceRlsRegistryDiff = {
  /** Tables expected to be FORCE-RLS but not enforced in the database (missing or disabled). */
  missing: string[];
  /** Tables FORCE-RLS in the database but absent from {@link EXPECTED_FORCE_RLS_TABLES}. */
  extra: string[];
};

/**
 * Computes the drift between the live-database FORCE-RLS set and the intentional
 * {@link EXPECTED_FORCE_RLS_TABLES} registry.
 *
 * @remarks
 * - **Algorithm:** set difference both directions on the canonical `<schema>.<table>` key.
 * - **Failure modes:** none — pure function; the caller decides how to surface a non-empty diff.
 * - **Side effects:** none.
 * - **Notes:** `databaseTables` should be queried from `pg_class.relforcerowsecurity` joined to
 *   `pg_namespace` with `relkind IN ('r','p')` so partitioned parents are included. Any non-empty
 *   `missing` or `extra` means the registry drifted from migration truth and must be reconciled.
 */
export function diffForceRlsTables(
  databaseTables: ForceRlsTableRef[],
  expected: ForceRlsTableRef[] = EXPECTED_FORCE_RLS_TABLES,
): ForceRlsRegistryDiff {
  const databaseKeys = new Set(
    databaseTables.map((table) => forceRlsTableKey(table.schemaName, table.tableName)),
  );
  const expectedKeys = new Set(
    expected.map((table) => forceRlsTableKey(table.schemaName, table.tableName)),
  );
  const missing = [...expectedKeys]
    .filter((key) => !databaseKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  const extra = [...databaseKeys]
    .filter((key) => !expectedKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  return { missing, extra };
}
