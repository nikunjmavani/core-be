/**
 * One-step GitHub bootstrap.
 *
 * Runs — in order — to bring a fresh repository (or fresh deploy target) up to
 * the committed source-of-truth state. Idempotent: safe to re-run.
 *
 *   1. gh auth preflight (show active user, allow switch).
 *   2. Sync rulesets (POST new ones, PUT existing by name).
 *   3. Sync each GitHub Environment from .github/environments/*.json — ensure it
 *      exists and apply its protection (required reviewers + deployment branch
 *      policy) so the committed JSON is the source of truth and drift self-heals.
 *
 * Single trunk: `main` is the only long-lived branch and it is the repository
 * default — always present — so there is no branch-creation step. Hotfixes
 * fix-forward to `main` via ordinary `fix/*` branches; there are no protected
 * release branches.
 *
 * Does NOT push variables or secrets. Use `pnpm github:sync` for that.
 *
 * Usage:
 *   Invoked by `pnpm github:sync` (and `github:sync --check` / `--dry-run`).
 *   Do not run this file directly — use `pnpm github:sync`.
 *
 * Modes:
 *   default      — write changes to the remote.
 *   --check      — read-only drift report; exit non-zero if anything is missing.
 *   --dry-run    — show what would be created or updated without writing.
 *
 * Plan note: repository rulesets require GitHub Pro / Team / Enterprise on
 * private repos. Environment creation works on every plan. So on the free
 * personal plan this script creates environments, then fails at the rulesets
 * step with the upstream "Upgrade to GitHub Pro …" message.
 */

import { resolveGitMetadata } from '@tooling/setup/codegen/project-identity.util.js';
import { loadConfig } from '@tooling/setup/common/config.js';
import { runGhAuthPreflight } from './auth-preflight.js';
import { getGithubSyncEnvironmentNames, scaffoldGithubSyncFiles } from './sync-config.js';
import { syncEnvironmentProtection } from './sync-environment-protection.js';
import {
  getRepositoryIdentifier,
  loadLocalRulesets,
  syncRulesets,
  type SyncMode,
} from './rulesets.js';

export interface RunGithubInitResult {
  readonly failures: number;
  readonly drift: number;
}

/**
 * Run the init pipeline. Exported so `tooling/setup/github/sync.ts` can compose
 * it without spawning a subprocess.
 */
export async function runGithubInit(args: {
  readonly mode: SyncMode;
  readonly purpose?: string;
  /** Skip gh auth preflight (e.g. setup:infra with GITHUB_TOKEN only). */
  readonly skipPreflight?: boolean;
  /** When true, scaffold local IaC on sync mode (default). github/sync.ts passes false — it scaffolds first. */
  readonly scaffoldOnSync?: boolean;
  /**
   * Restrict the sync to these environment names (setup:infra runs this once per environment, so
   * each pass syncs only that environment's ruleset + GitHub Environment). Omit for the whole
   * repository (`pnpm github:sync`).
   */
  readonly environmentNames?: readonly string[];
}): Promise<RunGithubInitResult> {
  const config = loadConfig();
  const scaffoldOnSync = args.scaffoldOnSync ?? true;
  if (args.mode === 'sync' && scaffoldOnSync) {
    scaffoldGithubSyncFiles(config);
  }

  const repository = getRepositoryIdentifier();
  const allLocals = loadLocalRulesets();
  const allEnvironments = getGithubSyncEnvironmentNames(config);

  // Per-environment scope: narrow rulesets / GitHub Environments to the requested environment(s).
  // Single trunk: every environment deploys from `git.defaultBranch` and the trunk's committed
  // ruleset is `<defaultBranch>.json` (main.json — always present), so there is no branch-creation
  // step; only rulesets and GitHub Environments are reconciled here.
  const scopeEnvironments = args.environmentNames;
  const scopedBranches = new Set([resolveGitMetadata(config).defaultBranch]);
  const environments = scopeEnvironments
    ? allEnvironments.filter((environment) => scopeEnvironments.includes(environment))
    : allEnvironments;
  const locals = scopeEnvironments
    ? allLocals.filter((local) => scopedBranches.has(local.fileName.replace(/\.json$/, '')))
    : allLocals;

  console.log(`Repository:    ${repository}`);
  console.log(`Mode:          ${args.mode}`);
  console.log('Config:        tooling/setup/setup.config.json');
  console.log(`Rulesets:      ${locals.map((local) => local.fileName).join(', ')}`);
  console.log(`Environments:  ${environments.length > 0 ? environments.join(', ') : '(none)'}`);
  console.log('');

  if (!args.skipPreflight) {
    await runGhAuthPreflight({
      repository,
      purpose: args.purpose ?? 'Sync GitHub rulesets and environments',
      destructive: args.mode === 'sync',
    });
  }

  console.log('Step 1/2 — Syncing rulesets');
  const rulesetResult = syncRulesets({ repository, locals, mode: args.mode });

  console.log('');
  console.log('Step 2/2 — Syncing GitHub Environment protection (reviewers + branch policy)');
  const environmentResult = syncEnvironmentProtection({
    repository,
    environments,
    mode: args.mode,
  });

  return {
    failures: rulesetResult.failures + environmentResult.failures,
    drift: rulesetResult.drift + environmentResult.drift,
  };
}
