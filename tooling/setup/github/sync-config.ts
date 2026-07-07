import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveGitMetadata } from '@tooling/setup/codegen/project-identity.util.js';
import { loadConfig, getEnvironmentNames } from '@tooling/setup/common/config.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';

const projectRoot = resolve(import.meta.dirname, '../../..');
const environmentExamplePath = resolve(projectRoot, '.env.example');
const environmentSchemaPath = resolve(projectRoot, 'src/shared/config/env-schema.ts');
const githubEnvironmentsDirectory = resolve(projectRoot, '.github/environments');
const githubRulesetsDirectory = resolve(projectRoot, '.github/rulesets');
const deployWorkflowPath = resolve(projectRoot, '.github/workflows/reusable-railway-deploy.yml');

export interface GitHubSyncScaffoldResult {
  readonly createdEnvironmentFiles: string[];
  readonly createdGithubEnvironmentConfigs: string[];
  readonly createdRulesets: string[];
}

export interface GitHubSyncConsistencyIssue {
  readonly dimension: string;
  readonly detail: string;
}

interface SyncEnvironment {
  name: string;
  branch: string;
}

const TOP_BANNER_LINE = /^#\s=+\s*$/;
const HALF_BANNER_LINE = /^#\s#{3,}\s*$/;
const NODE_ENV_LINE = /^NODE_ENV=.*$/m;

function environmentsFromConfig(config: SetupConfig): SyncEnvironment[] {
  // Single trunk: every environment deploys from the default branch — there is no
  // per-environment branch, so the ruleset/branch scoping keys on the single trunk.
  const { defaultBranch } = resolveGitMetadata(config);
  return config.environments.map((e) => ({ name: e.name, branch: defaultBranch }));
}

function extractNodeEnvironmentValues(): string[] {
  const source = readFileSync(environmentSchemaPath, 'utf-8');
  const match = source.match(/nodeEnvSchema\s*=\s*z\s*\.enum\(\[([^\]]+)\]\)/);
  if (!match) {
    throw new Error(`Could not locate nodeEnvSchema enum in ${environmentSchemaPath}`);
  }
  const enumSource = match[1] ?? '';
  return [...enumSource.matchAll(/'([a-z][a-z0-9-]*)'/g)]
    .map((enumMatch) => enumMatch[1])
    .filter((value): value is string => value !== undefined);
}

function listGithubEnvironmentConfigs(): string[] {
  const entries = readdirSync(githubEnvironmentsDirectory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!(entry.isFile() && entry.name.endsWith('.json'))) continue;
    const content = readFileSync(resolve(githubEnvironmentsDirectory, entry.name), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
      names.push(String((parsed as { name: unknown }).name));
    }
  }
  return names.sort();
}

function parseWorkflowBranchEnvironmentMap(): Map<string, string> {
  const source = readFileSync(deployWorkflowPath, 'utf-8');
  const lineRegex = /([a-z][a-z0-9-]*)\)\s*echo\s+"environment=([a-z][a-z0-9-]*)"/g;
  const map = new Map<string, string>();
  for (const match of source.matchAll(lineRegex)) {
    const branch = match[1];
    const environment = match[2];
    if (branch === undefined || environment === undefined) {
      continue;
    }
    map.set(branch, environment);
  }
  return map;
}

// Single-trunk: one branch (main) deploys to MULTIPLE environments — development on
// every merge and production on release — chosen EXPLICITLY by the caller via the
// `github_environment` workflow_call input, not derived from the branch. The 1:1
// branch→environment assertion below is relaxed for such branches when the deploy
// workflow accepts that input.
function deployWorkflowSupportsExplicitEnvironment(): boolean {
  return readFileSync(deployWorkflowPath, 'utf-8').includes('github_environment:');
}

export function validateGithubSyncConsistency(config: SetupConfig): GitHubSyncConsistencyIssue[] {
  const syncEnvironments = environmentsFromConfig(config);
  const nodeEnvironmentValues = new Set(extractNodeEnvironmentValues());
  const configuredEnvironmentNames = new Set(syncEnvironments.map((e) => e.name));
  const configuredBranches = new Set(syncEnvironments.map((e) => e.branch));
  const githubEnvs = new Set(listGithubEnvironmentConfigs());
  const workflowMap = parseWorkflowBranchEnvironmentMap();
  const workflowEnvs = new Set(workflowMap.values());
  const issues: GitHubSyncConsistencyIssue[] = [];

  for (const env of syncEnvironments) {
    if (!nodeEnvironmentValues.has(env.name)) {
      issues.push({
        dimension: 'setup.config.json ↔ NODE_ENV',
        detail: `Configured environment "${env.name}" is not in the NODE_ENV enum (${[...nodeEnvironmentValues].join(', ')}).`,
      });
    }
    if (!existsSync(resolve(githubRulesetsDirectory, `${env.branch}.json`))) {
      issues.push({
        dimension: 'setup.config.json ↔ rulesets',
        detail: `Configured branch "${env.branch}" has no .github/rulesets/${env.branch}.json.`,
      });
    }
  }

  for (const env of githubEnvs) {
    if (!nodeEnvironmentValues.has(env)) {
      issues.push({
        dimension: '.github/environments',
        detail: `GitHub environment "${env}" is not in the NODE_ENV enum (${[...nodeEnvironmentValues].join(', ')}).`,
      });
    }
    if (!configuredEnvironmentNames.has(env)) {
      issues.push({
        dimension: '.github/environments ↔ setup.config.json',
        detail: `GitHub environment "${env}" is not listed in setup.config.json.`,
      });
    }
  }

  for (const env of configuredEnvironmentNames) {
    if (!githubEnvs.has(env)) {
      issues.push({
        dimension: 'setup.config.json ↔ GitHub envs',
        detail: `Configured environment "${env}" has no .github/environments/${env}.json.`,
      });
    }
  }

  for (const env of workflowEnvs) {
    if (!nodeEnvironmentValues.has(env)) {
      issues.push({
        dimension: 'reusable-railway-deploy.yml',
        detail: `Workflow targets environment "${env}" which is not in the NODE_ENV enum.`,
      });
    }
  }

  for (const [branch, env] of workflowMap.entries()) {
    if (!configuredBranches.has(branch)) {
      issues.push({
        dimension: 'reusable-railway-deploy.yml ↔ setup.config.json',
        detail: `Workflow branch "${branch}" is not listed in setup.config.json.`,
      });
    }
    if (!configuredEnvironmentNames.has(env)) {
      issues.push({
        dimension: 'reusable-railway-deploy.yml ↔ setup.config.json',
        detail: `Workflow environment "${env}" is not listed in setup.config.json.`,
      });
    }
  }

  const environmentsByBranch = new Map<string, string[]>();
  for (const env of syncEnvironments) {
    environmentsByBranch.set(env.branch, [
      ...(environmentsByBranch.get(env.branch) ?? []),
      env.name,
    ]);
  }
  const workflowSupportsExplicitEnvironment = deployWorkflowSupportsExplicitEnvironment();
  for (const [branch, envNames] of environmentsByBranch) {
    if (envNames.length > 1) {
      // Multi-environment branch (single-trunk): the workflow must select the
      // environment explicitly instead of deriving it from the branch.
      if (!workflowSupportsExplicitEnvironment) {
        issues.push({
          dimension: 'setup.config.json ↔ reusable-railway-deploy.yml',
          detail: `Branch "${branch}" maps to multiple environments (${envNames.join(', ')}); reusable-railway-deploy.yml must accept a github_environment input to select one explicitly.`,
        });
      }
      continue;
    }
    const [only] = envNames;
    if (only !== undefined && workflowMap.get(branch) !== only) {
      issues.push({
        dimension: 'setup.config.json ↔ reusable-railway-deploy.yml',
        detail: `Configured branch "${branch}" must map to environment "${only}" in reusable-railway-deploy.yml.`,
      });
    }
  }

  return issues;
}

export function printGithubSyncConsistencyReport(config: SetupConfig): void {
  const syncEnvironments = environmentsFromConfig(config);
  const nodeEnvironmentValues = extractNodeEnvironmentValues();
  const githubEnvs = listGithubEnvironmentConfigs();
  const workflowMap = parseWorkflowBranchEnvironmentMap();

  console.log('Environment consistency');
  console.log('----------------------');
  console.log(`NODE_ENV enum:    ${nodeEnvironmentValues.join(', ')}`);
  console.log(
    `Sync config:      ${syncEnvironments.map((e) => `${e.branch}→${e.name}`).join(', ')}`,
  );
  console.log(`GitHub envs:      ${githubEnvs.join(', ')}`);
  console.log(
    `Workflow mapping: ${[...workflowMap.entries()].map(([b, e]) => `${b}→${e}`).join(', ')}`,
  );
  console.log('');
}

export function getGithubSyncEnvironmentNames(config?: SetupConfig): string[] {
  return getEnvironmentNames(config ?? loadConfig()).sort();
}

function buildEnvironmentFile(environment: string, exampleContent: string): string {
  const lines = exampleContent.split('\n');
  const bodyStartIndex = lines.findIndex((line) => HALF_BANNER_LINE.test(line));
  if (bodyStartIndex === -1) {
    throw new Error('Cannot find a `# ###...###` half banner in .env.example.');
  }

  const introBlock = lines.slice(0, bodyStartIndex);
  const equalsBanners = introBlock.filter((line) => TOP_BANNER_LINE.test(line)).length;
  if (equalsBanners === 0) {
    throw new Error('No `# ===...===` banner found before the first half banner in .env.example.');
  }

  const environmentHeader = [
    '# =============================================================================',
    `# Environment file for "${environment}"`,
    '# =============================================================================',
    '#',
    '# This file mirrors .env.example with descriptions preserved.',
    '# Fill required values before syncing to GitHub.',
    '#',
    `# Push with: pnpm setup:github`,
    '#',
    '# =============================================================================',
    '',
  ];

  const body = lines.slice(bodyStartIndex);
  return [...environmentHeader, ...body]
    .join('\n')
    .replace(NODE_ENV_LINE, `NODE_ENV=${environment}`);
}

function buildGithubEnvironmentConfig(environment: string): string {
  return `${JSON.stringify({ name: environment, protection: {} }, null, 2)}\n`;
}

function buildBranchRuleset(branch: string): string {
  const ruleset = {
    name: `Protect ${branch}`,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${branch}`] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          allowed_merge_methods: ['squash'],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          // Two aggregate contexts only. `Quality gate` (pr-ci.yml) rolls up every
          // required PR-CI lane; `Checks` (pr-governance.yml) is the governance
          // gate. GitHub reports a status-check context as the bare job `name:` —
          // NEVER prefixed by the workflow — so these are bare, matching the
          // committed `<branch>.json`. Adding a lane changes the aggregator's
          // `needs:`, not this list. Scaffold-only (writeIfMissing): once the
          // committed ruleset exists on disk it is the source of truth.
          required_status_checks: [{ context: 'Quality gate' }, { context: 'Checks' }],
        },
      },
    ],
  };
  return `${JSON.stringify(ruleset, null, 2)}\n`;
}

function writeIfMissing(filePath: string, contents: string): boolean {
  if (existsSync(filePath)) {
    return false;
  }
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents, 'utf-8');
  return true;
}

function scaffoldGithubSyncEnvironment(
  env: SyncEnvironment,
  exampleContent: string,
): GitHubSyncScaffoldResult {
  const result: GitHubSyncScaffoldResult = {
    createdEnvironmentFiles: [],
    createdGithubEnvironmentConfigs: [],
    createdRulesets: [],
  };

  const envFilePath = resolve(projectRoot, `.env.${env.name}`);
  if (writeIfMissing(envFilePath, buildEnvironmentFile(env.name, exampleContent))) {
    result.createdEnvironmentFiles.push(`.env.${env.name}`);
  }

  const githubEnvPath = resolve(projectRoot, `.github/environments/${env.name}.json`);
  if (writeIfMissing(githubEnvPath, buildGithubEnvironmentConfig(env.name))) {
    result.createdGithubEnvironmentConfigs.push(`.github/environments/${env.name}.json`);
  }

  const rulesetPath = resolve(projectRoot, `.github/rulesets/${env.branch}.json`);
  if (writeIfMissing(rulesetPath, buildBranchRuleset(env.branch))) {
    result.createdRulesets.push(`.github/rulesets/${env.branch}.json`);
  }

  return result;
}

export function scaffoldGithubSyncFiles(config?: SetupConfig): GitHubSyncScaffoldResult {
  const cfg = config ?? loadConfig();
  if (!existsSync(environmentExamplePath)) {
    throw new Error('Cannot find .env.example at the repo root.');
  }

  const syncEnvironments = environmentsFromConfig(cfg);
  const exampleContent = readFileSync(environmentExamplePath, 'utf-8');
  const result: GitHubSyncScaffoldResult = {
    createdEnvironmentFiles: [],
    createdGithubEnvironmentConfigs: [],
    createdRulesets: [],
  };

  for (const env of syncEnvironments) {
    const single = scaffoldGithubSyncEnvironment(env, exampleContent);
    result.createdEnvironmentFiles.push(...single.createdEnvironmentFiles);
    result.createdGithubEnvironmentConfigs.push(...single.createdGithubEnvironmentConfigs);
    result.createdRulesets.push(...single.createdRulesets);
  }

  return result;
}
