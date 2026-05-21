/**
 * Scaffold a new hosted environment so all dimensions stay 1:1.
 *
 * Generates / verifies (all idempotent):
 *   1. `<name>` is in the `NODE_ENV` enum (`src/shared/config/env-schema.ts`).
 *   2. `.env.<name>` local file (copy of `.env.example`, gitignored). This is the source
 *      of truth fed to `pnpm env:sync <name>`.
 *   3. `.github/environments/<name>.json` protection config (committed IaC).
 *   4. `.github/rulesets/<branch>.json` branch ruleset (committed IaC, when --branch set).
 *   5. Printed checklist of follow-up commands (edit values, `pnpm env:sync`, workflow case).
 *
 * Run: pnpm env:add <name> [--branch <branch>]
 *   e.g. pnpm env:add staging --branch staging
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../..');
const envSchemaPath = resolve(projectRoot, 'src/shared/config/env-schema.ts');
const envExamplePath = resolve(projectRoot, '.env.example');

interface ParsedArguments {
  readonly name: string;
  readonly branch?: string;
}

function parseArguments(argv: string[]): ParsedArguments {
  const positional: string[] = [];
  let branch: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--branch') {
      branch = argv[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm env:add <name> [--branch <branch>]');
      console.log('  <name>     Environment name (must be a NODE_ENV enum value)');
      console.log('  --branch   Git branch that deploys to this environment (default: <name>)');
      process.exit(0);
    }
    if (arg !== undefined && !arg.startsWith('--')) {
      positional.push(arg);
    }
  }
  if (positional.length === 0 || positional[0] === undefined) {
    console.error('Missing required argument: <name>');
    console.error('Usage: pnpm env:add <name> [--branch <branch>]');
    process.exit(2);
  }
  return { name: positional[0], ...(branch !== undefined ? { branch } : {}) };
}

function extractNodeEnvValues(): string[] {
  const source = readFileSync(envSchemaPath, 'utf-8');
  const match = source.match(/nodeEnvSchema\s*=\s*z\s*\.enum\(\[([^\]]+)\]\)/);
  if (!match) {
    throw new Error(`Could not locate nodeEnvSchema enum in ${envSchemaPath}`);
  }
  return [...(match[1]?.matchAll(/'([a-z][a-z0-9-]*)'/g) ?? [])].map((m) => m[1]!);
}

function buildGithubEnvironmentConfig(name: string): string {
  return `${JSON.stringify({ name, protection: {} }, null, 2)}\n`;
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

function writeIfMissing(filePath: string, contents: string, label: string): boolean {
  if (existsSync(filePath)) {
    console.log(`  • ${label} already exists at ${filePath} — keeping current contents`);
    return false;
  }
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents, 'utf-8');
  console.log(`  ✓ Created ${label}: ${filePath}`);
  return true;
}

function copyIfMissing(sourcePath: string, targetPath: string, label: string): boolean {
  if (existsSync(targetPath)) {
    console.log(`  • ${label} already exists at ${targetPath} — keeping current contents`);
    return false;
  }
  copyFileSync(sourcePath, targetPath);
  console.log(`  ✓ Created ${label}: ${targetPath}`);
  return true;
}

function main(): void {
  const parameters = parseArguments(process.argv.slice(2));
  const name = parameters.name;
  const branch = parameters.branch ?? name;

  const nodeEnvValues = extractNodeEnvValues();
  if (!nodeEnvValues.includes(name)) {
    console.error(`"${name}" is not in the NODE_ENV enum (${nodeEnvValues.join(', ')}).`);
    console.error(`Edit src/shared/config/env-schema.ts and add "${name}" first.`);
    process.exit(1);
  }

  if (!existsSync(envExamplePath)) {
    console.error('Cannot find .env.example at the repo root.');
    process.exit(1);
  }

  console.log(`Scaffolding environment "${name}" (branch: ${branch})`);
  console.log('');

  const envLocalPath = resolve(projectRoot, `.env.${name}`);
  const githubConfigPath = resolve(projectRoot, `.github/environments/${name}.json`);
  const rulesetPath = resolve(projectRoot, `.github/rulesets/${branch}.json`);

  copyIfMissing(envExamplePath, envLocalPath, `.env.${name} (local, gitignored)`);
  writeIfMissing(githubConfigPath, buildGithubEnvironmentConfig(name), 'GitHub environment config');
  writeIfMissing(rulesetPath, buildBranchRuleset(branch), 'Branch ruleset');

  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log(`  1. Edit .env.${name} with real values (DB URL, JWT keys, Sentry DSN, etc.).`);
  console.log('');
  console.log(`  2. Sync to GitHub:`);
  console.log(`     pnpm env:sync ${name}`);
  console.log('');
  console.log(`  3. Add a case statement to .github/workflows/deploy-railway.yml:`);
  console.log(`       ${branch}) echo "environment=${name}" >> "$GITHUB_OUTPUT" ;;`);
  console.log(`     and add "${branch}" to the workflow_run.branches list.`);
  console.log('');
  console.log(`  4. Verify consistency:`);
  console.log(`     pnpm validate:env-consistency`);
  console.log(`     CONFIG=${name} pnpm validate:github-env`);
}

main();
