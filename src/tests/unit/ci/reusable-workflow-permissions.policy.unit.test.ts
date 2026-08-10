import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Caller/callee permission contract for local reusable workflows.
 *
 * A called workflow can never hold MORE than the calling job was granted. When a caller job
 * omits its own `permissions:` block it inherits the workflow-level default — which is
 * `contents: read` in this repo, meaning every other scope is `none`. If the callee's jobs then
 * request `packages: write` (or any other elevated scope), GitHub rejects the ENTIRE run at
 * startup: `startup_failure`, zero jobs, and no logs retrievable through the REST API.
 *
 * That is not hypothetical. `release-deploy.yml` shipped without permissions on its
 * reusable-calling jobs and failed this way on **9 consecutive releases** over a month —
 * production was never deployed once — while every PR stayed green, because actionlint does not
 * model this rule and nothing else exercises a `release`-triggered workflow.
 */
const ROOT = process.cwd();
const WORKFLOW_DIRECTORY = join(ROOT, '.github/workflows');

/** Ordered so a numeric comparison decides whether a grant covers a request. */
const PERMISSION_RANK: Record<string, number> = { none: 0, read: 1, write: 2 };

/** Splits a workflow into its top-level job blocks (`jobs:` children are indented two spaces). */
function parseJobBlocks(workflow: string): Map<string, string> {
  const jobsSection = workflow.split(/^jobs:\s*$/m)[1] ?? '';
  const blocks = new Map<string, string>();
  let currentName = '';
  let currentLines: string[] = [];

  for (const line of jobsSection.split('\n')) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header?.[1]) {
      if (currentName) blocks.set(currentName, currentLines.join('\n'));
      currentName = header[1];
      currentLines = [];
      continue;
    }
    if (currentName) currentLines.push(line);
  }
  if (currentName) blocks.set(currentName, currentLines.join('\n'));

  return blocks;
}

/** Reads a `permissions:` mapping at the given indent, or null when the block is absent. */
function parsePermissions(block: string, indent: number): Map<string, string> | null {
  const pad = ' '.repeat(indent);
  const entryPad = ' '.repeat(indent + 2);
  const lines = block.split('\n');
  const start = lines.indexOf(`${pad}permissions:`);
  if (start === -1) return null;

  const permissions = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    const entry = new RegExp(`^${entryPad}([a-z-]+):\\s*([a-z]+)\\s*$`).exec(line);
    const scope = entry?.[1];
    const level = entry?.[2];
    if (!(scope && level)) break;
    permissions.set(scope, level);
  }
  return permissions;
}

/** Workflow-level `permissions:` (column 0), the default every job inherits. */
function parseWorkflowPermissions(workflow: string): Map<string, string> {
  return parsePermissions(workflow, 0) ?? new Map();
}

/** Every elevated scope any job inside a reusable workflow asks for. */
function requiredPermissions(reusableWorkflow: string): Map<string, string> {
  const required = new Map<string, string>();
  for (const block of parseJobBlocks(reusableWorkflow).values()) {
    for (const [scope, level] of parsePermissions(block, 4) ?? []) {
      const current = required.get(scope);
      const isHigher = (PERMISSION_RANK[level] ?? 0) > (PERMISSION_RANK[current ?? 'none'] ?? 0);
      if (!current || isHigher) required.set(scope, level);
    }
  }
  return required;
}

interface ReusableCall {
  readonly callerWorkflow: string;
  readonly callerJob: string;
  readonly calleeWorkflow: string;
  readonly granted: Map<string, string>;
  readonly required: Map<string, string>;
}

function collectReusableCalls(): ReusableCall[] {
  const calls: ReusableCall[] = [];
  const files = readdirSync(WORKFLOW_DIRECTORY).filter((name) => name.endsWith('.yml'));

  for (const file of files) {
    const workflow = readFileSync(join(WORKFLOW_DIRECTORY, file), 'utf8');
    const workflowPermissions = parseWorkflowPermissions(workflow);

    for (const [jobName, block] of parseJobBlocks(workflow)) {
      const callee = /^\s*uses:\s*\.\/\.github\/workflows\/([A-Za-z0-9._-]+\.yml)\s*$/m.exec(block);
      if (!callee?.[1]) continue;

      calls.push({
        callerWorkflow: file,
        callerJob: jobName,
        calleeWorkflow: callee[1],
        // A job-level block REPLACES the workflow default outright — it is not merged.
        granted: parsePermissions(block, 4) ?? workflowPermissions,
        required: requiredPermissions(readFileSync(join(WORKFLOW_DIRECTORY, callee[1]), 'utf8')),
      });
    }
  }

  return calls;
}

describe('reusable workflow permission contract', () => {
  const calls = collectReusableCalls();

  it('finds the reusable-workflow calls it is meant to guard', () => {
    // Guards the parser itself: a regex that silently matches nothing would make every
    // assertion below vacuous, which is the failure mode this whole suite exists to prevent.
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.some((call) => call.callerWorkflow === 'release-deploy.yml')).toBe(true);
    expect(calls.some((call) => call.required.get('packages') === 'write')).toBe(true);
  });

  it('grants every calling job at least what its called workflow requests', () => {
    const violations = calls.flatMap((call) =>
      [...call.required]
        .filter(([scope, level]) => {
          const grantedLevel = call.granted.get(scope) ?? 'none';
          return (PERMISSION_RANK[grantedLevel] ?? 0) < (PERMISSION_RANK[level] ?? 0);
        })
        .map(
          ([scope, level]) =>
            `${call.callerWorkflow} job '${call.callerJob}' → ${call.calleeWorkflow}: ` +
            `needs ${scope}:${level}, granted ${call.granted.get(scope) ?? 'none'}`,
        ),
    );

    expect(violations).toEqual([]);
  });
});
