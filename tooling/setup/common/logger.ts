import chalk from 'chalk';
import ora, { type Ora } from 'ora';

let activeSpinner: Ora | null = null;

export function banner(projectName: string, environments: string[]): void {
  const line = '═'.repeat(58);
  console.log('');
  console.log(chalk.cyan(`╔${line}╗`));
  console.log(
    chalk.cyan('║') +
      chalk.bold.white(`  ${projectName} — One-Command Setup`).padEnd(58) +
      chalk.cyan('║'),
  );
  console.log(
    chalk.cyan('║') +
      chalk.gray(`  Environments: ${environments.join(', ')}`).padEnd(58) +
      chalk.cyan('║'),
  );
  console.log(chalk.cyan(`╚${line}╝`));
  console.log('');
}

export interface EnvironmentBranchEntry {
  name: string;
  label?: string;
  branch: string;
  services?: string[];
  isDefault?: boolean;
}

export function environmentBranchMapping(entries: EnvironmentBranchEntry[]): void {
  if (entries.length === 0) return;
  const line = '─'.repeat(60);
  const branchWidth = Math.max(8, ...entries.map((entry) => entry.branch.length));
  const environmentWidth = Math.max(
    11,
    ...entries.map((entry) => `${entry.name}${entry.label ? ` (${entry.label})` : ''}`.length),
  );

  console.log(chalk.bold.cyan('  Branch / Environment / Services'));
  console.log(chalk.gray(`  ${line}`));
  for (const entry of entries) {
    const defaultMark = entry.isDefault ? chalk.yellow(' (default)') : '';
    const environment = `${entry.name}${entry.label ? ` (${entry.label})` : ''}`;
    const services = entry.services?.length ? entry.services.join(', ') : 'n/a';
    console.log(
      chalk.white('    ') +
        chalk.bold.green(entry.branch.padEnd(branchWidth)) +
        chalk.gray('  →  ') +
        chalk.bold.white(environment.padEnd(environmentWidth)) +
        defaultMark +
        chalk.gray('  →  services: ') +
        chalk.cyan(services),
    );
  }
  console.log(chalk.gray(`  ${line}`));
  console.log('');
}

export function stepHeader(step: number, total: number, providerName: string): void {
  const line = '═'.repeat(58);
  console.log('');
  console.log(chalk.yellow(`╔${line}╗`));
  console.log(
    chalk.yellow('║') +
      chalk.bold.white(`  Step ${step}/${total} — ${providerName}`).padEnd(58) +
      chalk.yellow('║'),
  );
  console.log(chalk.yellow(`╚${line}╝`));
  console.log('');
}

export function info(message: string): void {
  console.log(chalk.blue('  ℹ ') + message);
}

export function success(message: string): void {
  console.log(chalk.green('  ✓ ') + message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('  ⚠ ') + message);
}

export function error(message: string): void {
  console.log(chalk.red('  ✗ ') + message);
}

export function instruction(lines: string[]): void {
  console.log('');
  console.log(chalk.bold.white('  Instructions:'));
  for (const line of lines) {
    console.log(chalk.gray(`    ${line}`));
  }
  console.log('');
}

export function secretField(path: string): void {
  console.log(chalk.cyan(`       ${path}`) + chalk.yellow('    <──'));
}

export function blank(): void {
  console.log('');
}

export function divider(): void {
  console.log(chalk.gray('  ' + '─'.repeat(56)));
}

export function startSpinner(message: string): Ora {
  activeSpinner = ora({ text: message, indent: 2 }).start();
  return activeSpinner;
}

export function stopSpinner(
  spinner: Ora,
  message: string,
  status: 'succeed' | 'fail' | 'warn' = 'succeed',
): void {
  if (status === 'succeed') spinner.succeed(message);
  else if (status === 'fail') spinner.fail(message);
  else spinner.warn(message);
  activeSpinner = null;
}

export function summary(title: string, items: Array<{ label: string; value: string }>): void {
  console.log('');
  console.log(chalk.bold.green(`  ${title}`));
  divider();
  for (const item of items) {
    console.log(chalk.white(`  ${item.label.padEnd(30)}`) + chalk.cyan(item.value));
  }
  divider();
  console.log('');
}

export function table(rows: Array<{ env: string; status: string; detail: string }>): void {
  console.log('');
  console.log(chalk.bold('  ' + 'Environment'.padEnd(14) + 'Status'.padEnd(12) + 'Detail'));
  divider();
  for (const row of rows) {
    const statusColor = row.status === 'OK' ? chalk.green : chalk.red;
    console.log(
      '  ' +
        chalk.white(row.env.padEnd(14)) +
        statusColor(row.status.padEnd(12)) +
        chalk.gray(row.detail),
    );
  }
  console.log('');
}

export function settingsReview(
  projectName: string,
  organization: string,
  environments: Array<string | EnvironmentBranchEntry>,
  resources: Array<{ provider: string; detail: string }>,
  extras: Array<{ provider: string; detail: string }>,
): void {
  const line = '─'.repeat(60);
  const entries = environments.map((environment) =>
    typeof environment === 'string' ? { name: environment, branch: '' } : environment,
  );
  const hasBranches = entries.some((entry) => entry.branch.length > 0);

  console.log('');
  console.log(chalk.bold.cyan('  SETTINGS REVIEW'));
  console.log(chalk.gray(`  ${line}`));
  console.log('');
  console.log(chalk.white('  Project:       ') + chalk.bold.white(projectName));
  console.log(chalk.white('  Organization:  ') + chalk.bold.white(organization));
  if (hasBranches) {
    const formatted = entries
      .map((entry) => {
        const environment = `${entry.name}${entry.label ? ` (${entry.label})` : ''}`;
        const services = entry.services?.length ? ` [services: ${entry.services.join(', ')}]` : '';
        return entry.branch ? `${entry.branch} → ${environment}${services}` : environment;
      })
      .join(', ');
    console.log(chalk.white('  Branches:      ') + chalk.bold.white(formatted));
  } else {
    console.log(
      chalk.white('  Environments:  ') +
        chalk.bold.white(entries.map((entry) => entry.name).join(', ')),
    );
  }
  console.log('');
  console.log(chalk.bold.yellow('  Resources to CREATE:'));
  for (const resource of resources) {
    console.log(
      chalk.green('    + ') +
        chalk.white(resource.provider.padEnd(18)) +
        chalk.gray(resource.detail),
    );
  }
  if (extras.length > 0) {
    console.log('');
    console.log(chalk.bold.blue('  Additional actions:'));
    for (const extra of extras) {
      console.log(
        chalk.blue('    ~ ') + chalk.white(extra.provider.padEnd(18)) + chalk.gray(extra.detail),
      );
    }
  }
  console.log('');
  console.log(chalk.gray(`  ${line}`));
  console.log('');
}

export function existingResourcesError(
  existing: Array<{ provider: string; detail: string }>,
): void {
  const line = '─'.repeat(60);
  console.log('');
  console.log(chalk.bold.red('  EXISTING RESOURCES DETECTED'));
  console.log(chalk.gray(`  ${line}`));
  console.log('');
  for (const resource of existing) {
    console.log(
      chalk.red('    ! ') + chalk.white(resource.provider.padEnd(18)) + chalk.gray(resource.detail),
    );
  }
  console.log('');
  console.log(
    chalk.yellow(
      '  setup:infra never deletes resources. Run "pnpm setup:infra --delete" to see the dashboard URLs and identifiers, then delete them manually before re-running.',
    ),
  );
  console.log(chalk.yellow('  Aborting — no resources were created.'));
  console.log(chalk.gray(`  ${line}`));
  console.log('');
}

export function previewPlan(
  configPath: string,
  secretsPath: string,
  providers: Array<{
    provider: string;
    detail: string;
    url: string;
    configKey: string;
  }>,
): void {
  const line = '─'.repeat(60);
  console.log('');
  console.log(chalk.bold.cyan('  SETUP PREVIEW — Third parties & token instructions'));
  console.log(chalk.gray(`  ${line}`));
  console.log('');
  console.log(chalk.white('  Config file:   ') + chalk.cyan(configPath));
  console.log(chalk.white('  Secrets file:  ') + chalk.cyan(secretsPath));
  console.log('');
  console.log(chalk.bold.yellow('  Providers to provision (fill tokens in secrets file):'));
  console.log('');
  for (const provider of providers) {
    console.log(chalk.green('    ' + provider.provider));
    console.log(chalk.gray(`      → ${provider.detail}`));
    console.log(chalk.gray(`      → Get token: ${provider.url}`));
    console.log(chalk.gray(`      → In .env.setup: ${provider.configKey}=<value>`));
    console.log('');
  }
  console.log(chalk.gray(`  ${line}`));
  console.log(
    chalk.bold.white(
      '  Token-only: No gh auth login or railway login required when GITHUB_TOKEN and RAILWAY_TOKEN are set in .env.setup.',
    ),
  );
  console.log(
    chalk.gray('  See docs/deployment/setup-token-instructions.md for GITHUB_TOKEN step-by-step.'),
  );
  console.log('');
  console.log(chalk.bold.white('  Next step: Fill ' + secretsPath));
  console.log(chalk.gray('  Then run: pnpm setup:infra (double confirm before provisioning)'));
  console.log('');
}

export interface DeleteInstructionsBlock {
  provider: string;
  dashboardUrl: string;
  steps?: string[];
  resources: Array<{ label: string; identifier: string }>;
}

/**
 * Renders the manual-delete guide for `pnpm setup:infra --delete`.
 * setup:infra does not delete anything — this only prints dashboard URLs and
 * the identifiers from `.setup-state.json` so the user can clean up by hand.
 */
export function deleteInstructionsReview(blocks: DeleteInstructionsBlock[]): void {
  const line = '─'.repeat(60);
  console.log('');
  console.log(chalk.bold.red('  MANUAL-DELETE GUIDE'));
  console.log(chalk.gray(`  ${line}`));
  console.log(
    chalk.yellow(
      '  setup:infra never deletes resources. Open each dashboard below and remove the listed items by hand.',
    ),
  );
  console.log('');

  if (blocks.length === 0) {
    console.log(chalk.gray('  No provisioned resources recorded in .setup-state.json.'));
    console.log('');
    console.log(chalk.gray(`  ${line}`));
    console.log('');
    return;
  }

  for (const block of blocks) {
    console.log(chalk.bold.white(`    ${block.provider}`));
    console.log(chalk.gray('      Dashboard: ') + chalk.cyan(block.dashboardUrl));
    if (block.resources.length === 0) {
      console.log(chalk.gray('      Resources: none recorded'));
    } else {
      console.log(chalk.gray('      Resources to delete:'));
      const labelWidth = Math.max(...block.resources.map((resource) => resource.label.length), 12);
      for (const resource of block.resources) {
        console.log(
          chalk.red('        - ') +
            chalk.white(resource.label.padEnd(labelWidth)) +
            chalk.gray('  ') +
            chalk.cyan(resource.identifier),
        );
      }
    }
    if (block.steps && block.steps.length > 0) {
      console.log(chalk.gray('      Steps:'));
      for (const step of block.steps) {
        console.log(chalk.gray(`        • ${step}`));
      }
    }
    console.log('');
  }

  console.log(chalk.gray(`  ${line}`));
  console.log(
    chalk.yellow(
      '  After deleting in the dashboards, also remove the entries from tooling/setup/.setup-state.json (or delete the file) so a fresh re-run does not adopt them.',
    ),
  );
  console.log('');
}
