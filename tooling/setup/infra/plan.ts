/**
 * `pnpm setup:infra:plan` — a read-only diff of what exists vs what will be created or
 * updated, before any apply (our own plan/apply implementation):
 *
 *   CREATE     — resource is absent → apply will create it
 *   UP-TO-DATE — resource present in state, no changes
 *   UPDATE     — present but config drifted → apply will update it (lists changes)
 *   VALIDATE   — validate-only provider (verifies a credential each run; creates nothing)
 *   DISABLED   — turned off in setup.config.json or missing its secret
 *
 * No mutations, no network writes. Drives the same `detectStatus()` the guided apply uses,
 * so the plan and the apply agree.
 */
import { getEnvironmentNames, loadConfig } from '@tooling/setup/common/config.js';
import * as logger from '@tooling/setup/common/logger.js';
import { loadSecrets } from '@tooling/setup/common/secrets.js';
import { loadState } from '@tooling/setup/common/state.js';
import type { ResourceStatus } from '@tooling/setup/common/interactive-step.js';
import type { InfraProvider, InfraProviderContext } from '@tooling/setup/common/types.js';
import {
  buildProviderContext,
  selectProviders,
  type ProviderSelectionInput,
} from './orchestrator.js';

type PlanAction = 'CREATE' | 'UP-TO-DATE' | 'UPDATE' | 'VALIDATE' | 'DISABLED';

interface PlanRow {
  action: PlanAction;
  provider: string;
  organization: string;
  project: string;
  environments: string;
  services: string;
  changes: string[];
}

function actionFor(status: ResourceStatus): PlanAction {
  if (status.state === 'absent') return 'CREATE';
  if (status.state === 'drift') return 'UPDATE';
  return 'UP-TO-DATE';
}

// When several providers share a planGroup, the row keeps the most "active" action.
const ACTION_PRECEDENCE: PlanAction[] = ['CREATE', 'UPDATE', 'VALIDATE', 'UP-TO-DATE', 'DISABLED'];

function mergeCell(a: string, b: string): string {
  const parts = [...a.split(', '), ...b.split(', ')].filter((part) => part && part !== '—');
  return parts.length > 0 ? [...new Set(parts)].join(', ') : '—';
}

/** Collapse rows that share a `group` into one (used for Railway server + Redis). */
function mergeByGroup(rows: Array<PlanRow & { group: string }>): PlanRow[] {
  const merged = new Map<string, PlanRow & { group: string }>();
  for (const row of rows) {
    const existing = merged.get(row.group);
    if (!existing) {
      merged.set(row.group, { ...row, provider: row.group });
      continue;
    }
    existing.action =
      ACTION_PRECEDENCE.find((a) => a === existing.action || a === row.action) ?? existing.action;
    existing.organization =
      existing.organization !== '—' ? existing.organization : row.organization;
    existing.project = existing.project !== '—' ? existing.project : row.project;
    existing.environments = mergeCell(existing.environments, row.environments);
    existing.services = mergeCell(existing.services, row.services);
    existing.changes = [...existing.changes, ...row.changes];
  }
  return [...merged.values()];
}

/** State-based action + drift changes (the fast, default path). */
async function stateResult(
  provider: InfraProvider,
  context: InfraProviderContext,
): Promise<{ action: PlanAction; changes: string[] }> {
  const step = provider.buildStep(context);
  if (!step.enabled) return { action: 'DISABLED', changes: [] };
  if (!step.detectStatus) return { action: 'VALIDATE', changes: [] };
  const status = await step.detectStatus();
  return { action: actionFor(status), changes: status.changes ?? [] };
}

/** Remote action + field-level drift via `inspectRemote`; degrades to state on error. */
async function remoteResult(
  provider: InfraProvider,
  context: InfraProviderContext,
): Promise<{ action: PlanAction; changes: string[] }> {
  const step = provider.buildStep(context);
  if (!step.enabled) return { action: 'DISABLED', changes: [] };
  if (!provider.inspectRemote) return stateResult(provider, context);
  const inspection = await provider.inspectRemote(context);
  if (inspection.error) {
    const fallback = await stateResult(provider, context);
    return { action: fallback.action, changes: [`remote: ${inspection.error}`] };
  }
  if (!inspection.present) return { action: 'CREATE', changes: [] };
  const drift = inspection.fields.filter((field) => !field.matches);
  if (drift.length === 0) return { action: 'UP-TO-DATE', changes: [] };
  return {
    action: 'UPDATE',
    changes: drift.map(
      (field) => `${field.label}: ${field.expected || '—'} → ${field.remote || '—'}`,
    ),
  };
}

const COLUMNS = [
  'ACTION',
  'PROVIDER',
  'ORGANIZATION',
  'PROJECT',
  'ENVIRONMENTS',
  'SERVICES',
] as const;

/**
 * Render the plan for a set of providers against an already-built context (read-only).
 * Shared by `runPlan` (the command) and the guided apply (so plan and apply agree).
 * Columns (organization/project/environments) come from each provider's `describe()`,
 * so the names match exactly what that provider's code uses (all from setup.config.json).
 */
export async function renderPlan(
  providers: readonly InfraProvider[],
  context: InfraProviderContext,
  remote = false,
): Promise<void> {
  const rawRows: Array<PlanRow & { group: string }> = [];
  for (const provider of providers) {
    const description = provider.describe?.(context) ?? {};
    const { action, changes } = remote
      ? await remoteResult(provider, context)
      : await stateResult(provider, context);
    rawRows.push({
      action,
      provider: provider.name,
      group: description.planGroup ?? provider.name,
      organization: description.organization ?? '—',
      project: description.project ?? '—',
      environments: description.environments?.join(', ') ?? '—',
      services: description.services?.join(', ') ?? '—',
      changes,
    });
  }

  // Collapse grouped providers (e.g. Railway server + Redis) into a single row.
  const rows = mergeByGroup(rawRows);

  const cells = (row: PlanRow): string[] => [
    row.action,
    row.provider,
    row.organization,
    row.project,
    row.environments,
    row.services,
  ];
  const widths = COLUMNS.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => cells(row)[index]?.length ?? 0)),
  );
  const line = (values: readonly string[]): string =>
    `  ${values.map((value, index) => value.padEnd(widths[index] ?? 0)).join('  ')}`;

  logger.info(line(COLUMNS));
  logger.info(line(widths.map((width) => '─'.repeat(width))));
  for (const row of rows) {
    logger.info(line(cells(row)));
    for (const change of row.changes) logger.info(`  ${' '.repeat(widths[0] ?? 0)}  • ${change}`);
  }

  const count = (action: PlanAction) => rows.filter((row) => row.action === action).length;
  logger.blank();
  logger.info(
    `Plan: ${count('CREATE')} to create, ${count('UPDATE')} to update, ${count('UP-TO-DATE')} up-to-date, ` +
      `${count('VALIDATE')} to validate, ${count('DISABLED')} disabled.`,
  );
}

/** `pnpm setup:infra:plan` entrypoint — build the context, render the plan, print footer. */
export async function runPlan(
  options: { providerSelection?: ProviderSelectionInput; remote?: boolean } = {},
): Promise<void> {
  const config = loadConfig();
  const environments = getEnvironmentNames(config);
  const context = buildProviderContext(config, loadSecrets(config), loadState(), environments);
  const source = options.remote ? 'live remote' : 'local state';

  logger.info(
    `Plan (${source}) — ${config.project.displayName} (${config.project.name}) · ${environments.join(', ')}`,
  );
  logger.blank();
  await renderPlan(selectProviders(options.providerSelection), context, options.remote ?? false);
  logger.info(
    'Read-only — nothing was changed. Run `pnpm setup:infra` to apply (step-wise, guided).',
  );
}
