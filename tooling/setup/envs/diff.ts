/**
 * Diff local .env.<environment> vs GitHub Environment secrets/variables.
 *
 * Shows: keys in local but not on GitHub, keys on GitHub but not local,
 * and value differences for variables (secrets can't be compared).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '../common/logger.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

function getGitHubSecretNames(environment: string): string[] {
  try {
    const output = execSync(
      `gh api --paginate repos/:owner/:repo/environments/${environment}/secrets --jq '.secrets[].name'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 },
    );
    return output
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getGitHubVariableEntries(environment: string): Array<{ name: string; value: string }> {
  try {
    const output = execSync(
      `gh api --paginate repos/:owner/:repo/environments/${environment}/variables --jq '.variables[] | {name, value} | @json'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 },
    );
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as { name?: string; value?: string };
        return { name: parsed.name ?? '', value: parsed.value ?? '' };
      });
  } catch {
    return [];
  }
}

export interface DiffResult {
  environment: string;
  localOnly: string[];
  githubOnly: string[];
  valueMismatches: Array<{ key: string; local: string; github: string }>;
}

/**
 * Diff local .env file against GitHub environment.
 */
export function diffEnvWithGitHub(environment: string): DiffResult {
  const filePath = resolve(PROJECT_ROOT, `.env.${environment}`);
  const localVars = existsSync(filePath) ? parseEnvFile(filePath) : {};

  const githubSecretNames = getGitHubSecretNames(environment);
  const githubVariableEntries = getGitHubVariableEntries(environment);
  const githubVars = new Map(githubVariableEntries.map((e) => [e.name, e.value]));

  const localKeys = new Set(Object.keys(localVars));
  const githubKeys = new Set([...githubSecretNames, ...githubVars.keys()]);

  const localOnly = [...localKeys].filter((k) => !githubKeys.has(k));
  const githubOnly = [...githubKeys].filter((k) => !localKeys.has(k));
  const valueMismatches: Array<{ key: string; local: string; github: string }> = [];

  for (const key of localKeys) {
    const localVal = localVars[key] ?? '';
    const githubVal = githubVars.get(key);
    if (githubVal !== undefined && localVal !== githubVal && !githubSecretNames.includes(key)) {
      valueMismatches.push({ key, local: localVal, github: githubVal });
    }
  }

  return { environment, localOnly, githubOnly, valueMismatches };
}

/**
 * Print diff results.
 */
export function printDiff(environment: string): void {
  const result = diffEnvWithGitHub(environment);

  console.log(`Diff: .env.${environment} ↔ GitHub Environment "${environment}"`);
  console.log('');

  if (result.localOnly.length > 0) {
    console.log('  In local but NOT on GitHub:');
    for (const key of result.localOnly) {
      console.log(`    + ${key}`);
    }
    console.log('');
  }

  if (result.githubOnly.length > 0) {
    console.log('  On GitHub but NOT in local:');
    for (const key of result.githubOnly) {
      console.log(`    - ${key}`);
    }
    console.log('');
  }

  if (result.valueMismatches.length > 0) {
    console.log('  Value mismatches (variables only):');
    for (const { key, local, github } of result.valueMismatches) {
      console.log(`    ~ ${key}: local="${local}" github="${github}"`);
    }
    console.log('');
  }

  if (
    result.localOnly.length === 0 &&
    result.githubOnly.length === 0 &&
    result.valueMismatches.length === 0
  ) {
    logger.success('No differences — local matches GitHub.');
  }
}
