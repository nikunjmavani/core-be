/**
 * Pre-flight summary builder for setup provisioning.
 *
 * Shows what WILL be created, what is SKIPPED (disabled in config),
 * and what is ALREADY DONE (resources found in remote or state).
 */
import type { SetupConfig } from '../common/types.js';
import { INFRA_PROVIDERS } from './providers/index.js';
import { loadState } from '../common/state.js';
import { getEnvironmentNames } from '../common/config.js';

export interface SummaryLine {
  status: 'create' | 'skip' | 'done';
  provider: string;
  detail: string;
}

/**
 * Build a summary of what will happen during provisioning.
 */
export function buildSummary(config: SetupConfig): {
  environments: string[];
  willCreate: SummaryLine[];
  skipped: SummaryLine[];
  alreadyDone: SummaryLine[];
} {
  const environments = getEnvironmentNames(config);
  const state = loadState();

  const willCreate: SummaryLine[] = [];
  const skipped: SummaryLine[] = [];
  const alreadyDone: SummaryLine[] = [];

  for (const provider of INFRA_PROVIDERS) {
    const enabled = provider.isEnabled({
      config,
      secrets: {} as never, // secrets not needed for summary
      state,
      environments,
      applyStateUpdates: () => {},
    });

    if (!enabled) {
      skipped.push({
        status: 'skip',
        provider: provider.name,
        detail: provider.disabledReason({
          config,
          secrets: {} as never,
          state,
          environments,
          applyStateUpdates: () => {},
        }),
      });
      continue;
    }

    // Check if any resources exist in state
    const providerState = (state as Record<string, unknown>)[provider.key];
    if (
      providerState &&
      typeof providerState === 'object' &&
      Object.keys(providerState).length > 0
    ) {
      alreadyDone.push({
        status: 'done',
        provider: provider.name,
        detail: `${environments.length} environment(s)`,
      });
    } else {
      willCreate.push({
        status: 'create',
        provider: provider.name,
        detail: `${environments.length} environment(s): ${environments.join(', ')}`,
      });
    }
  }

  return { environments, willCreate, skipped, alreadyDone };
}

/**
 * Print the summary to the console.
 */
export function printSummary(
  project: string,
  org: string,
  willCreate: SummaryLine[],
  skipped: SummaryLine[],
  alreadyDone: SummaryLine[],
): void {
  const line = '═'.repeat(60);

  console.log('');
  console.log('  SETUP SUMMARY');
  console.log(`  ${line}`);
  console.log('');
  console.log(`  Project:     ${project}`);
  console.log(`  Org:         ${org}`);
  console.log('');

  if (willCreate.length > 0) {
    console.log('  WILL CREATE:');
    for (const item of willCreate) {
      console.log(`    + ${item.provider.padEnd(18)} ${item.detail}`);
    }
    console.log('');
  }

  if (skipped.length > 0) {
    console.log('  SKIPPED (disabled in config):');
    for (const item of skipped) {
      console.log(`    - ${item.provider.padEnd(18)} ${item.detail}`);
    }
    console.log('');
  }

  if (alreadyDone.length > 0) {
    console.log('  ALREADY DONE (in state):');
    for (const item of alreadyDone) {
      console.log(`    ✓ ${item.provider.padEnd(18)} ${item.detail}`);
    }
    console.log('');
  }

  console.log(`  ${line}`);
  console.log('');
}
