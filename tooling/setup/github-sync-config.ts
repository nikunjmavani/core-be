import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const projectRoot = resolve(import.meta.dirname, '../..');
const githubSyncConfigPath = resolve(projectRoot, '.github/sync.config.json');
const environmentExamplePath = resolve(projectRoot, '.env.example');
const environmentSchemaPath = resolve(projectRoot, 'src/shared/config/env-schema.ts');
const githubEnvironmentsDirectory = resolve(projectRoot, '.github/environments');
const githubRulesetsDirectory = resolve(projectRoot, '.github/rulesets');
const deployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy-railway.yml');

const githubSyncEnvironmentSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  branch: z.string().regex(/^[A-Za-z0-9._-]+$/),
});

const githubSyncConfigSchema = z.object({
  environments: z.array(githubSyncEnvironmentSchema).min(1),
});

export type GitHubSyncEnvironment = z.infer<typeof githubSyncEnvironmentSchema>;
export type GitHubSyncConfig = z.infer<typeof githubSyncConfigSchema>;

export interface GitHubSyncScaffoldResult {
  readonly createdEnvironmentFiles: string[];
  readonly createdGithubEnvironmentConfigs: string[];
  readonly createdRulesets: string[];
}

export interface GitHubSyncConsistencyIssue {
  readonly dimension: string;
  readonly detail: string;
}

const TOP_BANNER_LINE = /^#\s=+\s*$/;
const HALF_BANNER_LINE = /^#\s#{3,}\s*$/;
const NODE_ENV_LINE = /^NODE_ENV=.*$/m;

function extractNodeEnvironmentValues(): string[] {
  const source = readFileSync(environmentSchemaPath, 'utf-8');
  const match = source.match(/nodeEnvSchema\s*=\s*z\s*\.enum\(\[([^\]]+)\]\)/);
  if (!match) {
    throw new Error(`Could not locate nodeEnvSchema enum in ${environmentSchemaPath}`);
  }
  return [...(match[1]?.matchAll(/'([a-z][a-z0-9-]*)'/g) ?? [])].map((match) => match[1]!);
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

function parseWorkflowBranchEnvironmentMap(): Map<string, string> {
  const source = readFileSync(deployWorkflowPath, 'utf-8');
  const lineRegex = /([a-z][a-z0-9-]*)\)\s*echo\s+"environment=([a-z][a-z0-9-]*)"/g;
  const map = new Map<string, string>();
  for (const match of source.matchAll(lineRegex)) {
    map.set(match[1]!, match[2]!);
  }
  return map;
}

export function validateGithubSyncConsistency(config: GitHubSyncConfig): GitHubSyncConsistencyIssue[] {
  const nodeEnvironmentValues = new Set(extractNodeEnvironmentValues());
  const configuredEnvironmentNames = new Set(config.environments.map((environment) => environment.name));
  const configuredBranches = new Set(config.environments.map((environment) => environment.branch));
  const githubEnvironments = new Set(listGithubEnvironmentConfigs());
  const workflowMap = parseWorkflowBranchEnvironmentMap();
  const workflowEnvironments = new Set(workflowMap.values());
  const issues: GitHubSyncConsistencyIssue[] = [];

  for (const environment of config.environments) {
    if (!nodeEnvironmentValues.has(environment.name)) {
      issues.push({
        dimension: '.github/sync.config.json ↔ NODE_ENV',
        detail: `Configured environment "${environment.name}" is not in the NODE_ENV enum (${[...nodeEnvironmentValues].join(', ')}).`,
      });
    }
    if (!existsSync(resolve(githubRulesetsDirectory, `${environment.branch}.json`))) {
      issues.push({
        dimension: '.github/sync.config.json ↔ rulesets',
        detail: `Configured branch "${environment.branch}" has no .github/rulesets/${environment.branch}.json.`,
      });
    }
  }

  for (const environment of githubEnvironments) {
    if (!nodeEnvironmentValues.has(environment)) {
      issues.push({
        dimension: '.github/environments',
        detail: `GitHub environment "${environment}" is not in the NODE_ENV enum (${[...nodeEnvironmentValues].join(', ')}).`,
      });
    }
    if (!configuredEnvironmentNames.has(environment)) {
      issues.push({
        dimension: '.github/environments ↔ .github/sync.config.json',
        detail: `GitHub environment "${environment}" is not listed in .github/sync.config.json.`,
      });
    }
  }

  for (const environment of configuredEnvironmentNames) {
    if (!githubEnvironments.has(environment)) {
      issues.push({
        dimension: '.github/sync.config.json ↔ GitHub envs',
        detail: `Configured environment "${environment}" has no .github/environments/${environment}.json.`,
      });
    }
  }

  for (const environment of workflowEnvironments) {
    if (!nodeEnvironmentValues.has(environment)) {
      issues.push({
        dimension: 'deploy-railway.yml',
        detail: `Workflow targets environment "${environment}" which is not in the NODE_ENV enum.`,
      });
    }
  }

  for (const [branch, environment] of workflowMap.entries()) {
    if (!configuredBranches.has(branch)) {
      issues.push({
        dimension: 'deploy-railway.yml ↔ .github/sync.config.json',
        detail: `Workflow branch "${branch}" is not listed in .github/sync.config.json.`,
      });
    }
    if (!configuredEnvironmentNames.has(environment)) {
      issues.push({
        dimension: 'deploy-railway.yml ↔ .github/sync.config.json',
        detail: `Workflow environment "${environment}" is not listed in .github/sync.config.json.`,
      });
    }
  }

  for (const environment of config.environments) {
    if (workflowMap.get(environment.branch) !== environment.name) {
      issues.push({
        dimension: '.github/sync.config.json ↔ deploy-railway.yml',
        detail: `Configured branch "${environment.branch}" must map to environment "${environment.name}" in deploy-railway.yml.`,
      });
    }
  }

  return issues;
}

export function printGithubSyncConsistencyReport(config: GitHubSyncConfig): void {
  const nodeEnvironmentValues = extractNodeEnvironmentValues();
  const githubEnvironments = listGithubEnvironmentConfigs();
  const workflowMap = parseWorkflowBranchEnvironmentMap();

  console.log('Environment consistency');
  console.log('----------------------');
  console.log(`NODE_ENV enum:    ${nodeEnvironmentValues.join(', ')}`);
  console.log(
    `Sync config:      ${config.environments.map((entry) => `${entry.branch}→${entry.name}`).join(', ')}`,
  );
  console.log(`GitHub envs:      ${githubEnvironments.join(', ')}`);
  console.log(
    `Workflow mapping: ${[...workflowMap.entries()].map(([branch, environment]) => `${branch}→${environment}`).join(', ')}`,
  );
  console.log('');
}

export function loadGithubSyncConfig(): GitHubSyncConfig {
  if (!existsSync(githubSyncConfigPath)) {
    throw new Error(`Missing ${githubSyncConfigPath}. Add environments before running GitHub sync.`);
  }

  const raw = JSON.parse(readFileSync(githubSyncConfigPath, 'utf-8')) as unknown;
  const config = githubSyncConfigSchema.parse(raw);
  const seenNames = new Set<string>();
  const seenBranches = new Set<string>();

  for (const environment of config.environments) {
    if (seenNames.has(environment.name)) {
      throw new Error(`Duplicate GitHub sync environment name: ${environment.name}`);
    }
    if (seenBranches.has(environment.branch)) {
      throw new Error(`Duplicate GitHub sync branch mapping: ${environment.branch}`);
    }
    seenNames.add(environment.name);
    seenBranches.add(environment.branch);
  }

  return config;
}

export function getGithubSyncEnvironmentNames(config = loadGithubSyncConfig()): string[] {
  return config.environments.map((environment) => environment.name).sort();
}

export function getGithubSyncBranches(config = loadGithubSyncConfig()): string[] {
  return config.environments.map((environment) => environment.branch).sort();
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
    `# Push with: pnpm github:sync ${environment}`,
    '#',
    '# =============================================================================',
    '',
  ];

  const body = lines.slice(bodyStartIndex);
  return [...environmentHeader, ...body].join('\n').replace(NODE_ENV_LINE, `NODE_ENV=${environment}`);
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
          allowed_merge_methods: ['squash', 'merge'],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 1,
          required_review_thread_resolution: true,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: 'CI / Quality & static security' },
            { context: 'CI / Test (Postgres + Redis)' },
            { context: 'CI / API smoke (Postgres + Redis + live server)' },
            { context: 'PR Checks / PR Quality Gates' },
            { context: 'CI / Chaos (Postgres + Redis via Toxiproxy)' },
            { context: 'CI / Docker Build' },
          ],
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
  environment: GitHubSyncEnvironment,
  exampleContent: string,
): GitHubSyncScaffoldResult {
  const result: GitHubSyncScaffoldResult = {
    createdEnvironmentFiles: [],
    createdGithubEnvironmentConfigs: [],
    createdRulesets: [],
  };

  const environmentFilePath = resolve(projectRoot, `.env.${environment.name}`);
  if (writeIfMissing(environmentFilePath, buildEnvironmentFile(environment.name, exampleContent))) {
    result.createdEnvironmentFiles.push(`.env.${environment.name}`);
  }

  const githubEnvironmentPath = resolve(
    projectRoot,
    `.github/environments/${environment.name}.json`,
  );
  if (writeIfMissing(githubEnvironmentPath, buildGithubEnvironmentConfig(environment.name))) {
    result.createdGithubEnvironmentConfigs.push(`.github/environments/${environment.name}.json`);
  }

  const rulesetPath = resolve(projectRoot, `.github/rulesets/${environment.branch}.json`);
  if (writeIfMissing(rulesetPath, buildBranchRuleset(environment.branch))) {
    result.createdRulesets.push(`.github/rulesets/${environment.branch}.json`);
  }

  return result;
}
export function scaffoldGithubSyncFiles(config = loadGithubSyncConfig()): GitHubSyncScaffoldResult {
  if (!existsSync(environmentExamplePath)) {
    throw new Error('Cannot find .env.example at the repo root.');
  }

  const exampleContent = readFileSync(environmentExamplePath, 'utf-8');
  const result: GitHubSyncScaffoldResult = {
    createdEnvironmentFiles: [],
    createdGithubEnvironmentConfigs: [],
    createdRulesets: [],
  };

  for (const environment of config.environments) {
    const single = scaffoldGithubSyncEnvironment(environment, exampleContent);
    result.createdEnvironmentFiles.push(...single.createdEnvironmentFiles);
    result.createdGithubEnvironmentConfigs.push(...single.createdGithubEnvironmentConfigs);
    result.createdRulesets.push(...single.createdRulesets);
  }

  return result;
}
