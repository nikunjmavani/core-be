/**
 * Applies each GitHub Environment's protection — required reviewers and the
 * deployment branch policy — from its committed `.github/environments/<name>.json`,
 * so the declared config is the source of truth and any drift self-heals on every
 * `pnpm github:sync`.
 *
 * Previously the environment shell was created with an empty body and protection
 * was applied by hand in the GitHub UI, which is exactly how the production
 * `deploymentBranchPolicy` drifted (issues #924 / #877). This module closes that
 * gap: `--check` reports drift, `--dry-run` previews it, and the default mode
 * reconciles GitHub to the JSON.
 *
 * Safety: every dynamic value (reviewer logins aside, which are trusted config)
 * flows to `gh` through a stdin JSON body (`--input -`), never interpolated into
 * the shell command line — so branch-name globs like `v*` are never shell-expanded.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ghProbe, ghWriteWithBody } from './gh-exec.js';
import type { SyncMode } from './rulesets.js';

const ENVIRONMENTS_DIRECTORY = resolve(process.cwd(), '.github/environments');

/** A branch/tag ref allowed to deploy when custom branch policies are enabled. */
interface CustomBranchConfig {
  readonly name: string;
  readonly type: 'branch' | 'tag';
}

/** `deploymentBranchPolicy` block of a committed environment JSON. */
interface DeploymentBranchPolicyConfig {
  readonly protectedBranches: boolean;
  readonly customBranchPolicies: boolean;
  readonly customBranches?: readonly CustomBranchConfig[];
}

/** `requiredReviewers` block of a committed environment JSON. */
interface RequiredReviewersConfig {
  readonly users?: readonly string[];
  readonly teams?: readonly string[];
  readonly preventSelfReview?: boolean;
}

/** `protection` block of a committed environment JSON. */
interface EnvironmentProtectionConfig {
  readonly requiredReviewers?: RequiredReviewersConfig;
  readonly deploymentBranchPolicy?: DeploymentBranchPolicyConfig;
}

/** Parsed shape of a `.github/environments/<name>.json` file. */
interface EnvironmentConfigFile {
  readonly name: string;
  readonly protection?: EnvironmentProtectionConfig;
}

/** A resolved reviewer as GitHub's environment API expects it. */
interface ReviewerReference {
  readonly type: 'User' | 'Team';
  readonly id: number;
}

/** GitHub's `deployment_branch_policy` object (or `null` = all branches may deploy). */
interface DeploymentBranchPolicyState {
  readonly protected_branches: boolean;
  readonly custom_branch_policies: boolean;
}

/** The protection state the committed config wants for an environment. */
export interface DesiredEnvironment {
  readonly reviewers: readonly ReviewerReference[];
  readonly preventSelfReview: boolean;
  readonly deploymentBranchPolicy: DeploymentBranchPolicyState | null;
  readonly customBranches: readonly CustomBranchConfig[];
}

/** The protection state GitHub currently reports for an environment. */
export interface RemoteEnvironment {
  readonly exists: boolean;
  readonly reviewers: readonly ReviewerReference[];
  readonly preventSelfReview: boolean;
  readonly deploymentBranchPolicy: DeploymentBranchPolicyState | null;
  readonly customBranches: readonly CustomBranchConfig[];
}

function branchKey(branch: CustomBranchConfig): string {
  return `${branch.type}:${branch.name}`;
}

function reviewerKey(reviewer: ReviewerReference): string {
  return `${reviewer.type}:${reviewer.id}`;
}

/**
 * Pure diff between the committed intent and GitHub's current state. Returns one
 * human-readable line per drifted field (empty array = in sync). Exported so it
 * can be unit-tested without touching the network.
 *
 * @remarks
 * Algorithm: normalises a missing `deploymentBranchPolicy` to
 * `protected=false, custom=false` (GitHub's "all branches" default), then
 * compares the branch-policy toggles, the custom branch/tag set (whenever the
 * config enables custom policies), the reviewer id set, and `preventSelfReview`.
 * Failure modes: none — total function over its inputs. Side effects: none.
 */
export function diffEnvironment(desired: DesiredEnvironment, remote: RemoteEnvironment): string[] {
  if (!remote.exists) return ['missing on remote'];

  const issues: string[] = [];

  const desiredProtected = desired.deploymentBranchPolicy?.protected_branches ?? false;
  const desiredCustom = desired.deploymentBranchPolicy?.custom_branch_policies ?? false;
  const remoteProtected = remote.deploymentBranchPolicy?.protected_branches ?? false;
  const remoteCustom = remote.deploymentBranchPolicy?.custom_branch_policies ?? false;

  if (desiredProtected !== remoteProtected) {
    issues.push(
      `deploymentBranchPolicy.protectedBranches: config=${desiredProtected} github=${remoteProtected}`,
    );
  }
  if (desiredCustom !== remoteCustom) {
    issues.push(
      `deploymentBranchPolicy.customBranchPolicies: config=${desiredCustom} github=${remoteCustom}`,
    );
  }

  if (desiredCustom) {
    const desiredBranches = new Set(desired.customBranches.map(branchKey));
    const remoteBranches = new Set(remote.customBranches.map(branchKey));
    for (const key of desiredBranches) {
      if (!remoteBranches.has(key)) issues.push(`customBranch missing on github: ${key}`);
    }
    for (const key of remoteBranches) {
      if (!desiredBranches.has(key)) issues.push(`customBranch unexpected on github: ${key}`);
    }
  }

  const desiredReviewers = new Set(desired.reviewers.map(reviewerKey));
  const remoteReviewers = new Set(remote.reviewers.map(reviewerKey));
  const reviewersDiffer =
    desiredReviewers.size !== remoteReviewers.size ||
    [...desiredReviewers].some((key) => !remoteReviewers.has(key));
  if (reviewersDiffer) {
    issues.push(
      `requiredReviewers: config={${[...desiredReviewers].join(', ')}} github={${[...remoteReviewers].join(', ')}}`,
    );
  }

  if (desired.reviewers.length > 0 && desired.preventSelfReview !== remote.preventSelfReview) {
    issues.push(
      `preventSelfReview: config=${desired.preventSelfReview} github=${remote.preventSelfReview}`,
    );
  }

  return issues;
}

function readEnvironmentConfig(environment: string): EnvironmentConfigFile {
  const path = resolve(ENVIRONMENTS_DIRECTORY, `${environment}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as EnvironmentConfigFile;
}

const userIdCache = new Map<string, number>();

function resolveNumericId(probeArgs: readonly string[], subject: string): number {
  const probe = ghProbe([...probeArgs, '--jq', '.id']);
  if (probe.exitCode !== 0) {
    throw new Error(`Failed to resolve ${subject}: ${probe.stderr || probe.stdout}`.trim());
  }
  const id = Number.parseInt(probe.stdout.trim(), 10);
  if (!Number.isInteger(id)) {
    throw new Error(`${subject} did not resolve to a numeric id (got "${probe.stdout.trim()}")`);
  }
  return id;
}

function resolveUserId(login: string): number {
  const cached = userIdCache.get(login);
  if (cached !== undefined) return cached;
  const id = resolveNumericId(['api', `users/${login}`], `reviewer @${login}`);
  userIdCache.set(login, id);
  return id;
}

function resolveTeamId(repository: string, slug: string): number {
  const owner = repository.split('/')[0];
  return resolveNumericId(['api', `orgs/${owner}/teams/${slug}`], `reviewer team ${slug}`);
}

function buildDesiredEnvironment(
  repository: string,
  config: EnvironmentConfigFile,
): DesiredEnvironment {
  const protection = config.protection ?? {};
  const requiredReviewers = protection.requiredReviewers;

  const reviewers: ReviewerReference[] = [];
  for (const login of requiredReviewers?.users ?? []) {
    reviewers.push({ type: 'User', id: resolveUserId(login) });
  }
  for (const slug of requiredReviewers?.teams ?? []) {
    reviewers.push({ type: 'Team', id: resolveTeamId(repository, slug) });
  }

  const policy = protection.deploymentBranchPolicy;
  const deploymentBranchPolicy: DeploymentBranchPolicyState | null = policy
    ? {
        protected_branches: policy.protectedBranches,
        custom_branch_policies: policy.customBranchPolicies,
      }
    : null;

  return {
    reviewers,
    preventSelfReview: requiredReviewers?.preventSelfReview ?? false,
    deploymentBranchPolicy,
    customBranches: policy?.customBranches ?? [],
  };
}

interface RemoteBranchPolicy extends CustomBranchConfig {
  readonly id: number;
}

function readRemoteBranchPolicies(repository: string, environment: string): RemoteBranchPolicy[] {
  const probe = ghProbe([
    'api',
    `repos/${repository}/environments/${environment}/deployment-branch-policies`,
  ]);
  // 404 when custom branch policies are disabled — treat as "no policies".
  if (probe.exitCode !== 0) return [];
  const parsed = JSON.parse(probe.stdout) as {
    branch_policies?: Array<{ id: number; name: string; type?: 'branch' | 'tag' }>;
  };
  return (parsed.branch_policies ?? []).map((policy) => ({
    id: policy.id,
    name: policy.name,
    type: policy.type ?? 'branch',
  }));
}

function readRemoteEnvironment(repository: string, environment: string): RemoteEnvironment {
  const probe = ghProbe(['api', `repos/${repository}/environments/${environment}`]);
  if (probe.exitCode !== 0) {
    if (/HTTP\s+404/i.test(`${probe.stderr}${probe.stdout}`)) {
      return {
        exists: false,
        reviewers: [],
        preventSelfReview: false,
        deploymentBranchPolicy: null,
        customBranches: [],
      };
    }
    throw new Error(`Failed to read environment "${environment}": ${probe.stderr || probe.stdout}`);
  }

  const parsed = JSON.parse(probe.stdout) as {
    deployment_branch_policy: DeploymentBranchPolicyState | null;
    protection_rules?: Array<{
      type: string;
      prevent_self_review?: boolean | null;
      // The reviewer id is nested: { type: 'User', reviewer: { id, login, ... } }.
      reviewers?: Array<{ type: string; reviewer?: { id: number } }>;
    }>;
  };

  const reviewerRule = (parsed.protection_rules ?? []).find(
    (rule) => rule.type === 'required_reviewers',
  );
  const reviewers = (reviewerRule?.reviewers ?? []).flatMap((reviewer) => {
    const id = reviewer.reviewer?.id;
    if ((reviewer.type !== 'User' && reviewer.type !== 'Team') || typeof id !== 'number') {
      return [];
    }
    return [{ type: reviewer.type as 'User' | 'Team', id }];
  });

  const customBranches = parsed.deployment_branch_policy?.custom_branch_policies
    ? readRemoteBranchPolicies(repository, environment).map((policy) => ({
        name: policy.name,
        type: policy.type,
      }))
    : [];

  return {
    exists: true,
    reviewers,
    preventSelfReview: reviewerRule?.prevent_self_review ?? false,
    deploymentBranchPolicy: parsed.deployment_branch_policy,
    customBranches,
  };
}

function putEnvironment(
  repository: string,
  environment: string,
  desired: DesiredEnvironment,
): void {
  const body: Record<string, unknown> = {
    reviewers: desired.reviewers.map((reviewer) => ({ type: reviewer.type, id: reviewer.id })),
    deployment_branch_policy: desired.deploymentBranchPolicy,
  };
  if (desired.reviewers.length > 0) {
    body.prevent_self_review = desired.preventSelfReview;
  }
  ghWriteWithBody(
    [
      'api',
      '--method',
      'PUT',
      '-H',
      "'Accept: application/vnd.github+json'",
      `repos/${repository}/environments/${environment}`,
      '--input',
      '-',
    ],
    JSON.stringify(body),
  );
}

function reconcileCustomBranchPolicies(
  repository: string,
  environment: string,
  desired: readonly CustomBranchConfig[],
): void {
  const current = readRemoteBranchPolicies(repository, environment);
  const desiredKeys = new Set(desired.map(branchKey));
  const currentKeys = new Set(current.map(branchKey));

  for (const policy of current) {
    if (!desiredKeys.has(branchKey(policy))) {
      ghWriteWithBody(
        [
          'api',
          '--method',
          'DELETE',
          `repos/${repository}/environments/${environment}/deployment-branch-policies/${policy.id}`,
        ],
        '',
      );
    }
  }

  for (const branch of desired) {
    if (!currentKeys.has(branchKey(branch))) {
      ghWriteWithBody(
        [
          'api',
          '--method',
          'POST',
          `repos/${repository}/environments/${environment}/deployment-branch-policies`,
          '--input',
          '-',
        ],
        JSON.stringify({ name: branch.name, type: branch.type }),
      );
    }
  }
}

function applyEnvironment(
  repository: string,
  environment: string,
  desired: DesiredEnvironment,
): void {
  // PUT first: switching custom_branch_policies on is a prerequisite for the
  // deployment-branch-policies sub-resource to accept POSTs.
  putEnvironment(repository, environment, desired);
  if (desired.deploymentBranchPolicy?.custom_branch_policies) {
    reconcileCustomBranchPolicies(repository, environment, desired.customBranches);
  }
}

/** Aggregate outcome of a protection sync pass across environments. */
export interface EnvironmentProtectionResult {
  readonly failures: number;
  readonly drift: number;
}

/**
 * Reconcile each environment's protection to its committed JSON.
 *
 * @remarks
 * Algorithm: for every environment, build the desired state (resolving reviewer
 * logins to ids), read the remote state, diff them, then — by mode — report
 * drift (`check`), preview it (`dry-run`), or PUT the environment and reconcile
 * its custom branch/tag policies (`sync`). Failure modes: a per-environment `gh`
 * error is caught and counted in `failures` without aborting the others. Side
 * effects: in `sync` mode, writes environment protection + deployment-branch
 * policies to GitHub; other modes are read-only.
 */
export function syncEnvironmentProtection(args: {
  readonly repository: string;
  readonly environments: readonly string[];
  readonly mode: SyncMode;
}): EnvironmentProtectionResult {
  const { repository, environments, mode } = args;

  if (environments.length === 0) {
    console.log('  (no .github/environments/*.json files found)');
    return { failures: 0, drift: 0 };
  }

  let failures = 0;
  let drift = 0;

  for (const environment of environments) {
    try {
      const config = readEnvironmentConfig(environment);
      const desired = buildDesiredEnvironment(repository, config);
      const remote = readRemoteEnvironment(repository, environment);
      const issues = diffEnvironment(desired, remote);

      if (issues.length === 0) {
        console.log(`  ${environment}: in sync`);
        continue;
      }

      if (mode === 'check') {
        console.error(`  ${environment}: drift detected (${issues.length} issue(s))`);
        for (const issue of issues) console.error(`    - ${issue}`);
        drift += issues.length;
        continue;
      }

      if (mode === 'dry-run') {
        console.log(`  ${environment}: would apply (${issues.length} change(s))`);
        for (const issue of issues) console.log(`    - ${issue}`);
        continue;
      }

      applyEnvironment(repository, environment, desired);
      console.log(`  ${environment}: applied (${issues.length} change(s))`);
    } catch (environmentError) {
      failures += 1;
      const message =
        environmentError instanceof Error ? environmentError.message : String(environmentError);
      console.error(`  ${environment}: FAILED`);
      console.error(`    ${message.replace(/\n/g, '\n    ')}`);
    }
  }

  return { failures, drift };
}
