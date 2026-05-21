/**
 * Cross-dimension drift validator for environment naming.
 *
 * Every hosted environment must be 1:1 across all of these dimensions:
 *   1. `NODE_ENV` enum in `src/shared/config/env-schema.ts`
 *   2. `.github/environments/<name>.json` config file (committed IaC)
 *   3. `deploy-railway.yml` branch → env case mapping
 *
 * Per-environment values live in `.env.<name>` files at the repo root, but those are
 * gitignored (created via `pnpm env:init`, pushed via `pnpm env:sync`) so they are not a
 * committed dimension to validate.
 *
 * Exceptions:
 *   - `local` and `test` are valid `NODE_ENV` values that are NOT hosted (no branch,
 *     no GH env, no Railway target).
 *
 * Run: pnpm validate:env-consistency
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const envSchemaPath = resolve(projectRoot, 'src/shared/config/env-schema.ts');
const githubEnvironmentsDirectory = resolve(projectRoot, '.github/environments');
const deployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy-railway.yml');

/** NODE_ENV values that are valid runtime modes but never hosted as a GH env / branch. */
const NON_HOSTED_NODE_ENVS = new Set<string>(['local', 'test']);

interface ConsistencyIssue {
  readonly dimension: string;
  readonly detail: string;
}

function extractNodeEnvValues(): string[] {
  const source = readFileSync(envSchemaPath, 'utf-8');
  const match = source.match(/nodeEnvSchema\s*=\s*z\s*\.enum\(\[([^\]]+)\]\)/);
  if (!match) {
    throw new Error(`Could not locate nodeEnvSchema enum in ${envSchemaPath}`);
  }
  return [...(match[1]?.matchAll(/'([a-z][a-z0-9-]*)'/g) ?? [])].map((m) => m[1]!);
}

function listGithubEnvironmentConfigs(): string[] {
  const entries = readdirSync(githubEnvironmentsDirectory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const content = readFileSync(resolve(githubEnvironmentsDirectory, entry.name), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
      names.push(String((parsed as { name: unknown }).name));
    }
  }
  return names.sort();
}

/**
 * Parse the branch → environment mapping from the workflow's case statement. The line
 * shape (per deploy-railway.yml convention) is:
 *
 *   <branch>) echo "environment=<env>" >> "$GITHUB_OUTPUT" ;;
 */
function parseWorkflowBranchEnvironmentMap(): Map<string, string> {
  const source = readFileSync(deployWorkflowPath, 'utf-8');
  const lineRegex = /([a-z][a-z0-9-]*)\)\s*echo\s+"environment=([a-z][a-z0-9-]*)"/g;
  const map = new Map<string, string>();
  for (const match of source.matchAll(lineRegex)) {
    map.set(match[1]!, match[2]!);
  }
  return map;
}

function validateConsistency(): ConsistencyIssue[] {
  const nodeEnvValues = new Set(extractNodeEnvValues());
  const hostedNodeEnvs = new Set([...nodeEnvValues].filter((v) => !NON_HOSTED_NODE_ENVS.has(v)));
  const githubEnvironments = new Set(listGithubEnvironmentConfigs());
  const workflowMap = parseWorkflowBranchEnvironmentMap();
  const workflowEnvironments = new Set(workflowMap.values());

  const issues: ConsistencyIssue[] = [];

  // Every GitHub environment must be a valid NODE_ENV enum value.
  for (const environment of githubEnvironments) {
    if (!nodeEnvValues.has(environment)) {
      issues.push({
        dimension: '.github/environments',
        detail: `GitHub environment "${environment}" is not in the NODE_ENV enum (${[...nodeEnvValues].join(', ')}).`,
      });
    }
  }

  // Every workflow target must be a valid NODE_ENV enum value.
  for (const environment of workflowEnvironments) {
    if (!nodeEnvValues.has(environment)) {
      issues.push({
        dimension: 'deploy-railway.yml',
        detail: `Workflow targets environment "${environment}" which is not in the NODE_ENV enum.`,
      });
    }
  }

  // GH env ↔ workflow: a committed GH env should have a deploy target (otherwise nothing
  // will ever push to it).
  for (const environment of githubEnvironments) {
    if (!workflowEnvironments.has(environment)) {
      issues.push({
        dimension: 'GitHub envs ↔ workflow',
        detail: `GitHub environment "${environment}" is not referenced by any branch case in deploy-railway.yml.`,
      });
    }
  }

  // workflow ↔ GH env: a workflow target must have a committed GH env config.
  for (const environment of workflowEnvironments) {
    if (!githubEnvironments.has(environment)) {
      issues.push({
        dimension: 'workflow ↔ GitHub envs',
        detail: `Workflow deploys to "${environment}" but no .github/environments/${environment}.json exists.`,
      });
    }
  }

  // Hosted NODE_ENV values that are referenced by ANY other dimension must be wired through both.
  for (const environment of hostedNodeEnvs) {
    const inGithub = githubEnvironments.has(environment);
    const inWorkflow = workflowEnvironments.has(environment);
    if (!inGithub && !inWorkflow) continue; // reserved-but-unused value, e.g. staging
    if (!inGithub) {
      issues.push({
        dimension: 'NODE_ENV ↔ GitHub envs',
        detail: `NODE_ENV value "${environment}" is referenced by the deploy workflow but has no .github/environments/${environment}.json.`,
      });
    }
    if (!inWorkflow) {
      issues.push({
        dimension: 'NODE_ENV ↔ workflow',
        detail: `NODE_ENV value "${environment}" has a GitHub env config but is not targeted by deploy-railway.yml.`,
      });
    }
  }

  return issues;
}

function main(): void {
  const nodeEnvValues = extractNodeEnvValues();
  const githubEnvironments = listGithubEnvironmentConfigs();
  const workflowMap = parseWorkflowBranchEnvironmentMap();

  console.log('Environment consistency check');
  console.log('-----------------------------');
  console.log(`NODE_ENV enum:    ${nodeEnvValues.join(', ')}`);
  console.log(`GitHub envs:      ${githubEnvironments.join(', ')}`);
  console.log(
    `Workflow mapping: ${[...workflowMap.entries()].map(([b, e]) => `${b}→${e}`).join(', ')}`,
  );
  console.log('');

  const issues = validateConsistency();

  if (issues.length === 0) {
    console.log('All hosted environments are consistent across all dimensions.');
    process.exit(0);
  }

  console.error(`${issues.length} drift issue(s) detected:`);
  for (const issue of issues) {
    console.error(`  [${issue.dimension}] ${issue.detail}`);
  }
  console.error('');
  console.error(
    'Add a new environment with `pnpm env:add <name>` (see docs/deployment/runbooks/add-new-environment.md).',
  );
  process.exit(1);
}

main();
