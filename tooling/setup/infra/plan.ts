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

function planAction(provider: InfraProvider, context: InfraProviderContext): Promise<PlanAction> {
  const step = provider.buildStep(context);
  if (!step.enabled) return Promise.resolve('DISABLED');
  if (!step.detectStatus) return Promise.resolve('VALIDATE');
  return Promise.resolve(step.detectStatus()).then(actionFor);
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
): Promise<void> {
  const rows: PlanRow[] = [];
  for (const provider of providers) {
    const description = provider.describe?.(context) ?? {};
    const step = provider.buildStep(context);
    rows.push({
      action: await planAction(provider, context),
      provider: provider.name,
      organization: description.organization ?? '—',
      project: description.project ?? '—',
      environments: description.environments?.join(', ') ?? '—',
      services: description.services?.join(', ') ?? '—',
      changes: (step.detectStatus ? (await step.detectStatus()).changes : undefined) ?? [],
    });
  }

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
  options: { providerSelection?: ProviderSelectionInput } = {},
): Promise<void> {
  const config = loadConfig();
  const environments = getEnvironmentNames(config);
  const context = buildProviderContext(config, loadSecrets(config), loadState(), environments);

  logger.info(
    `Plan — ${config.project.displayName} (${config.project.name}) · ${environments.join(', ')}`,
  );
  logger.blank();
  await renderPlan(selectProviders(options.providerSelection), context);
  logger.info(
    'Read-only — nothing was changed. Run `pnpm setup:infra` to apply (step-wise, guided).',
  );
}
