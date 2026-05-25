import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareGitHubEnvironmentToConfig,
  driftResultsHaveIssues,
  loadGitHubEnvironmentConfigs,
  parseGitHubEnvironmentApiResponse,
  type GitHubEnvironmentDriftResult,
} from './environments-util.js';

export { driftResultsHaveIssues } from './environments-util.js';

const ENVIRONMENTS_DIRECTORY = resolve(import.meta.dirname, '../../../.github/environments');

function repositoryFromGitRemote(): string | undefined {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();

    const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^/.]+?)(?:\.git)?$/);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }

    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/);
    if (httpsMatch?.[1]) {
      return httpsMatch[1];
    }
  } catch {
    // fall through
  }

  return undefined;
}

function getRepositoryIdentifier(): string {
  if (process.env.GITHUB_REPOSITORY?.includes('/')) {
    return process.env.GITHUB_REPOSITORY;
  }

  const fromGit = repositoryFromGitRemote();
  if (fromGit) {
    return fromGit;
  }

  try {
    return execSync('gh repo view --json nameWithOwner -q .nameWithOwner', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim();
  } catch {
    throw new Error(
      'Cannot resolve repository: set GITHUB_REPOSITORY, use a github.com git remote, or authenticate gh.',
    );
  }
}

function fetchGitHubEnvironment(repository: string, environmentName: string): unknown {
  try {
    const output = execSync(`gh api repos/${repository}/environments/${environmentName}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return JSON.parse(output) as unknown;
  } catch (commandError) {
    const message = commandError instanceof Error ? commandError.message : String(commandError);
    throw new Error(
      `Failed to fetch GitHub environment "${environmentName}" for ${repository}: ${message}`,
    );
  }
}

export function validateGitHubEnvironmentsDrift(
  environmentsDirectory = ENVIRONMENTS_DIRECTORY,
): GitHubEnvironmentDriftResult[] {
  const repository = getRepositoryIdentifier();
  const configs = loadGitHubEnvironmentConfigs(environmentsDirectory);
  const results: GitHubEnvironmentDriftResult[] = [];

  console.log(`Validating GitHub environment protection (config ↔ UI)`);
  console.log(`  Repository: ${repository}`);
  console.log(`  Config directory: ${environmentsDirectory}`);
  console.log(`  Environments: ${configs.map((config) => config.name).join(', ')}`);
  console.log('');

  for (const config of configs) {
    const configPath = join(environmentsDirectory, `${config.name}.json`);
    const apiResponse = fetchGitHubEnvironment(repository, config.name);
    const live = parseGitHubEnvironmentApiResponse(apiResponse);
    const issues = compareGitHubEnvironmentToConfig(config, live);

    results.push({ environment: config.name, configPath, issues });

    if (issues.length === 0) {
      console.log(`  ${config.name}: OK`);
      continue;
    }

    console.error(`  ${config.name}: drift detected (${issues.length} issue(s))`);
    for (const issue of issues) {
      console.error(`    - ${issue.detail}`);
    }
  }

  console.log('');
  return results;
}

function printUsage(): void {
  console.log('Usage: pnpm validate:github-environments [--check]');
  console.log('');
  console.log('  --check   Compare .github/environments/*.json vs GitHub API (default)');
  console.log('  SKIP_GITHUB_ENV=1   Skip API calls');
}

function parseCommandLineArguments(): 'check' {
  const argumentsList = process.argv.slice(2);

  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (argumentsList.length === 0 || argumentsList.includes('--check')) {
    return 'check';
  }

  throw new Error(`Unknown argument(s): ${argumentsList.join(' ')}. Use --check or --help.`);
}

export function main(): void {
  const command = parseCommandLineArguments();
  if (command !== 'check') {
    throw new Error(`Unsupported command: ${command}`);
  }

  const skipGitHub = process.env.SKIP_GITHUB_ENV === '1' || process.env.SKIP_GITHUB_ENV === 'true';
  if (skipGitHub) {
    console.log('SKIP_GITHUB_ENV set — skipping GitHub environment protection drift check.');
    process.exit(0);
  }

  const results = validateGitHubEnvironmentsDrift();

  if (!driftResultsHaveIssues(results)) {
    console.log('GitHub environment protection: OK (committed config matches GitHub UI).');
    process.exit(0);
  }

  console.error(
    'GitHub environment protection drift: update GitHub UI or edit .github/environments/*.json so they match.',
  );
  console.error('See docs/deployment/github-production-environment.md');
  process.exit(1);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
