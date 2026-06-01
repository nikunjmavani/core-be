/**
 * Per-environment GitHub status dashboard.
 *
 * Shows a table of what's configured for each environment:
 * branches, rulesets, environments, secrets, and variables.
 */
import { execSync } from 'node:child_process';

interface EnvStatus {
  environment: string;
  branch: string;
  branchExists: boolean;
  rulesetExists: boolean;
  envExists: boolean;
  secretCount: number;
  variableCount: number;
}

function ghProbeExists(path: string): boolean {
  try {
    execSync(`gh api ${path}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function ghCount(path: string): number {
  try {
    const output = execSync(`gh api --paginate ${path} --jq 'length'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return Number.parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Build status for each environment.
 */
export function buildGitHubStatus(
  repository: string,
  environments: Array<{ name: string; branch: string }>,
): EnvStatus[] {
  return environments.map((env) => ({
    environment: env.name,
    branch: env.branch,
    branchExists: ghProbeExists(`repos/${repository}/branches/${env.branch}`),
    rulesetExists: ghProbeExists(`repos/${repository}/rulesets`),
    envExists: ghProbeExists(`repos/${repository}/environments/${env.name}`),
    secretCount: ghCount(`repos/${repository}/environments/${env.name}/secrets`),
    variableCount: ghCount(`repos/${repository}/environments/${env.name}/variables`),
  }));
}

/**
 * Print a status table.
 */
export function printGitHubStatus(statuses: EnvStatus[]): void {
  console.log('');
  console.log('  GitHub Environment Status');
  console.log(`  ${'─'.repeat(70)}`);
  console.log('');
  console.log(
    '  ' +
      'Environment'.padEnd(16) +
      'Branch'.padEnd(12) +
      'Branch?'.padEnd(10) +
      'Ruleset?'.padEnd(10) +
      'Env?'.padEnd(8) +
      'Secrets'.padEnd(10) +
      'Vars',
  );
  console.log(`  ${'─'.repeat(70)}`);

  for (const s of statuses) {
    console.log(
      '  ' +
        s.environment.padEnd(16) +
        s.branch.padEnd(12) +
        (s.branchExists ? '✓' : '✗').padEnd(10) +
        (s.rulesetExists ? '✓' : '✗').padEnd(10) +
        (s.envExists ? '✓' : '✗').padEnd(8) +
        String(s.secretCount).padEnd(10) +
        String(s.variableCount),
    );
  }
  console.log('');
}
