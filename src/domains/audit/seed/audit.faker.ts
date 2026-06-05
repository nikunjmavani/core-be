/**
 * Faker generators for the audit bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`. Generators vary action,
 * resource type, and severity, and spread `created_at` across a target month.
 */
import type { Faker } from '@faker-js/faker';

/** Representative audit actions, spread across the seeded ledger. */
const ACTIONS: readonly string[] = [
  'user.login',
  'user.logout',
  'organization.updated',
  'membership.invited',
  'membership.accepted',
  'membership.removed',
  'api_key.created',
  'api_key.revoked',
  'subscription.created',
  'subscription.canceled',
  'upload.created',
  'upload.deleted',
  'role.permission.granted',
];

/** Resource types paired with the actions above. */
const RESOURCE_TYPES: readonly string[] = [
  'user',
  'organization',
  'membership',
  'api_key',
  'subscription',
  'upload',
  'role',
];

/** Severities, weighted toward INFO with occasional WARNING / ERROR for realism. */
const SEVERITIES: readonly string[] = ['INFO', 'INFO', 'INFO', 'INFO', 'DEBUG', 'WARNING', 'ERROR'];

/** A generated audit log's varied fields (actor + organization are supplied by the seeder). */
export interface BulkAuditProfile {
  /** Action verb (e.g. `user.login`). */
  action: string;
  /** Resource type the action targeted (e.g. `organization`). */
  resource_type: string;
  /** Severity bucket (`DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL`). */
  severity: string;
  /** When the action occurred — spread across the target month. */
  created_at: Date;
}

/**
 * Builds one fake audit profile whose `created_at` falls within the given month window.
 *
 * @remarks
 * `monthStart` is the first instant of the month (UTC) and `nextMonthStart` the first instant
 * of the following month; the timestamp is drawn uniformly in `[monthStart, nextMonthStart)`.
 */
export function generateBulkAudit(
  faker: Faker,
  monthStart: Date,
  nextMonthStart: Date,
): BulkAuditProfile {
  return {
    action: faker.helpers.arrayElement(ACTIONS),
    resource_type: faker.helpers.arrayElement(RESOURCE_TYPES),
    severity: faker.helpers.arrayElement(SEVERITIES),
    created_at: faker.date.between({ from: monthStart, to: nextMonthStart }),
  };
}
