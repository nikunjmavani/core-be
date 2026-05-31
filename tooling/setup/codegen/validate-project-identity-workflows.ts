import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ProjectIdentitySnapshot } from './project-identity.util.js';

const WORKFLOWS_DIRECTORY_NAME = '.github/workflows';

/** GitHub Actions event / input names that look like branches but are not git refs. */
const NON_BRANCH_TOKENS = new Set([
  'pull_request',
  'workflow_dispatch',
  'workflow_run',
  'schedule',
  'completed',
  'closed',
  'merge',
  'head',
  'base',
  'true',
  'false',
  'skipped',
  'success',
  'failure',
  'cancelled',
]);

export interface WorkflowLiteralViolation {
  readonly file: string;
  readonly detail: string;
}

function stripYamlComments(contents: string): string {
  return contents
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
}

function collectBranchesFromArrayLiterals(contents: string): string[] {
  const branches: string[] = [];
  const pattern = /branches:\s*\[([^\]]+)\]/g;
  for (const match of contents.matchAll(pattern)) {
    const inner = match[1] ?? '';
    for (const token of inner.split(',')) {
      const branch = token.trim().replace(/^['"]|['"]$/g, '');
      if (branch.length > 0) {
        branches.push(branch);
      }
    }
  }
  return branches;
}

function collectRefNameComparisons(contents: string): string[] {
  const branches: string[] = [];
  const pattern = /github\.ref_name\s*==\s*['"]([a-zA-Z0-9._-]+)['"]/g;
  for (const match of contents.matchAll(pattern)) {
    const branch = match[1];
    if (branch) {
      branches.push(branch);
    }
  }
  return branches;
}

function collectCheckoutRefLines(contents: string): string[] {
  const branches: string[] = [];
  const pattern = /^\s+ref:\s+([a-zA-Z0-9._-]+)\s*$/gm;
  for (const match of contents.matchAll(pattern)) {
    const branch = match[1];
    if (branch && branch !== '${{') {
      branches.push(branch);
    }
  }
  return branches;
}

function collectCaseBranchArms(contents: string): string[] {
  const branches: string[] = [];
  const pattern = /^\s+([a-z][a-z0-9._-]*)\)\s*(?:echo|;|\|\|)/gm;
  for (const match of contents.matchAll(pattern)) {
    const branch = match[1];
    if (branch) {
      branches.push(branch);
    }
  }
  return branches;
}

function collectBranchLiterals(contents: string): string[] {
  const stripped = stripYamlComments(contents);
  return [
    ...collectBranchesFromArrayLiterals(stripped),
    ...collectRefNameComparisons(stripped),
    ...collectCheckoutRefLines(stripped),
    ...collectCaseBranchArms(stripped),
  ];
}

function findDisallowedBranchLiterals(options: {
  readonly contents: string;
  readonly allowedBranches: ReadonlySet<string>;
}): string[] {
  const disallowed = new Set<string>();
  for (const branch of collectBranchLiterals(options.contents)) {
    if (NON_BRANCH_TOKENS.has(branch)) {
      continue;
    }
    if (!options.allowedBranches.has(branch)) {
      disallowed.add(branch);
    }
  }
  return [...disallowed].sort();
}

function findDisallowedImageLiterals(options: {
  readonly contents: string;
  readonly imageNames: readonly string[];
}): string[] {
  const stripped = stripYamlComments(options.contents);
  const identityBlock = stripped.includes('# BEGIN GENERATED project-identity')
    ? (stripped
        .split('# BEGIN GENERATED project-identity')[1]
        ?.split('# END GENERATED project-identity')[0] ?? '')
    : '';
  const outsideGeneratedBlock = stripped.replace(identityBlock, '');
  const usesEnvSubstitution =
    /\$\{\{\s*env\.(API_IMAGE|WORKER_IMAGE|DOCKER_LOCAL_API_TAG|GHCR_CACHE_SCOPE_API|GHCR_CACHE_SCOPE_WORKER)\s*\}\}/.test(
      outsideGeneratedBlock,
    );
  if (usesEnvSubstitution) {
    return [];
  }

  const disallowed = new Set<string>();
  for (const imageName of options.imageNames) {
    if (
      new RegExp(`\\b${imageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
        outsideGeneratedBlock,
      )
    ) {
      disallowed.add(imageName);
    }
  }
  return [...disallowed].sort();
}

/**
 * Scans workflow YAML for branch and image literals that are not derived from the manifest.
 *
 * @remarks
 * Catches manual edits that bypass `pnpm tool:generate-project-identity` after a rebrand.
 */
export function validateWorkflowLiteralsAgainstManifest(options: {
  readonly snapshot: ProjectIdentitySnapshot;
  readonly projectRoot: string;
}): WorkflowLiteralViolation[] {
  const workflowsDirectory = resolve(options.projectRoot, WORKFLOWS_DIRECTORY_NAME);
  if (!existsSync(workflowsDirectory)) {
    return [];
  }

  const allowedBranches = new Set<string>([
    ...options.snapshot.git.protectedBranches,
    ...options.snapshot.environments.map((environment) => environment.branch),
  ]);
  const workflowImageNames = [
    options.snapshot.artifacts.apiImage,
    options.snapshot.artifacts.workerImage,
  ];

  const violations: WorkflowLiteralViolation[] = [];

  for (const fileName of readdirSync(workflowsDirectory).filter((name) => name.endsWith('.yml'))) {
    const filePath = resolve(workflowsDirectory, fileName);
    const contents = readFileSync(filePath, 'utf-8');
    const disallowedBranches = findDisallowedBranchLiterals({ contents, allowedBranches });
    if (disallowedBranches.length > 0) {
      violations.push({
        file: `${WORKFLOWS_DIRECTORY_NAME}/${fileName}`,
        detail: `Branch literal(s) not in setup.config.json: ${disallowedBranches.join(', ')}. Run: pnpm tool:generate-project-identity`,
      });
    }

    const disallowedImages = findDisallowedImageLiterals({
      contents,
      imageNames: workflowImageNames,
    });
    if (disallowedImages.length > 0) {
      violations.push({
        file: `${WORKFLOWS_DIRECTORY_NAME}/${fileName}`,
        detail: `Image name literal(s) should use generated env (API_IMAGE, WORKER_IMAGE, …): ${disallowedImages.join(', ')}`,
      });
    }
  }

  return violations;
}
