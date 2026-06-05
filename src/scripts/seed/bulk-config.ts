/**
 * Bulk-seed profiles and the env → counts resolver. Three named profiles (`demo`, `edge`,
 * `load`) provide base per-table counts; `SCALE` multiplies the volume-bearing counts and
 * per-knob env overrides win, all bounded by a hard cap that keeps runs in the
 * tens-of-thousands band where idempotent upserts + light batching stay viable.
 */
import type { ResolvedCounts } from './seed-contract.js';

/** Named bulk-seed profile. */
export type BulkProfile = 'demo' | 'edge' | 'load';

/** Base per-table counts for each profile (before `SCALE` and per-knob env overrides). */
export const PROFILES: Record<BulkProfile, ResolvedCounts> = {
  demo: {
    organizations: 10,
    usersPerOrg: { min: 2, max: 5 },
    customRolesPerOrg: 1,
    subscriptionsPerOrg: 1,
    apiKeysPerOrg: 2,
    webhooksPerOrg: 1,
    notificationsPerUser: 3,
    uploadsPerOrg: 2,
    auditMonths: 3,
    auditPerOrgPerMonth: 5,
    edgeCases: false,
  },
  edge: {
    organizations: 25,
    usersPerOrg: { min: 1, max: 6 },
    customRolesPerOrg: 2,
    subscriptionsPerOrg: 2,
    apiKeysPerOrg: 3,
    webhooksPerOrg: 2,
    notificationsPerUser: 4,
    uploadsPerOrg: 3,
    auditMonths: 4,
    auditPerOrgPerMonth: 6,
    edgeCases: true,
  },
  load: {
    organizations: 1000,
    usersPerOrg: { min: 5, max: 15 },
    customRolesPerOrg: 3,
    subscriptionsPerOrg: 2,
    apiKeysPerOrg: 3,
    webhooksPerOrg: 2,
    notificationsPerUser: 5,
    uploadsPerOrg: 4,
    auditMonths: 6,
    auditPerOrgPerMonth: 15,
    edgeCases: true,
  },
};

/** Upper bound that keeps a run within the tens-of-thousands band (COPY path is out of scope). */
export const HARD_CAP = { organizations: 5000, auditRows: 500_000 } as const;

/** Resolved run configuration: the chosen profile, the scale multiplier, and concrete counts. */
export interface ResolvedConfig {
  /** The selected profile name. */
  profile: BulkProfile;
  /** The applied `SCALE` multiplier. */
  scale: number;
  /** Concrete per-table counts after profile × scale × env overrides. */
  counts: ResolvedCounts;
}

function positiveIntegerFromEnvironment(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer env value: "${value}"`);
  }
  return parsed;
}

/**
 * Resolves the run config from the environment: `BULK_PROFILE` (default `demo`), `SCALE`
 * (default 1; multiplies organizations and audit rows), and per-knob overrides
 * (`BULK_ORGS`, `BULK_USERS_PER_ORG`, `BULK_AUDIT_MONTHS`, `BULK_AUDIT_PER_ORG_PER_MONTH`).
 *
 * @remarks
 * Failure modes: throws on an unknown profile, an invalid integer, or when the projected
 * organization / audit-row totals exceed {@link HARD_CAP}. Side effects: none.
 */
export function resolveCounts(environment: NodeJS.ProcessEnv): ResolvedConfig {
  const profileName = (environment.BULK_PROFILE ?? 'demo') as BulkProfile;
  const base = PROFILES[profileName];
  if (!base) {
    throw new Error(
      `Unknown BULK_PROFILE "${profileName}". Valid: ${Object.keys(PROFILES).join(', ')}`,
    );
  }

  const scale = positiveIntegerFromEnvironment(environment.SCALE, 1) || 1;

  const counts: ResolvedCounts = {
    ...base,
    organizations: positiveIntegerFromEnvironment(
      environment.BULK_ORGS,
      base.organizations * scale,
    ),
    auditMonths: positiveIntegerFromEnvironment(environment.BULK_AUDIT_MONTHS, base.auditMonths),
    auditPerOrgPerMonth: positiveIntegerFromEnvironment(
      environment.BULK_AUDIT_PER_ORG_PER_MONTH,
      base.auditPerOrgPerMonth * scale,
    ),
  };

  if (environment.BULK_USERS_PER_ORG !== undefined) {
    const usersPerOrg = positiveIntegerFromEnvironment(
      environment.BULK_USERS_PER_ORG,
      base.usersPerOrg.max,
    );
    counts.usersPerOrg = { min: usersPerOrg, max: usersPerOrg };
  }

  const projectedAuditRows = counts.organizations * counts.auditMonths * counts.auditPerOrgPerMonth;
  if (counts.organizations > HARD_CAP.organizations) {
    throw new Error(
      `Resolved organizations (${counts.organizations}) exceeds the bulk-seeder cap ` +
        `(${HARD_CAP.organizations}). The COPY-based load path is out of scope for this tool.`,
    );
  }
  if (projectedAuditRows > HARD_CAP.auditRows) {
    throw new Error(
      `Projected audit rows (${projectedAuditRows}) exceeds the bulk-seeder cap ` +
        `(${HARD_CAP.auditRows}). Lower SCALE / BULK_AUDIT_* (COPY path is out of scope).`,
    );
  }

  return { profile: profileName, scale, counts };
}
