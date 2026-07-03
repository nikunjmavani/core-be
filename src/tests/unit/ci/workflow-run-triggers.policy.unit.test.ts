import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOWS_DIR = join(process.cwd(), '.github/workflows');

interface WorkflowFile {
  file: string;
  content: string;
}

function loadWorkflows(): WorkflowFile[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => ({
      file,
      content: readFileSync(join(WORKFLOWS_DIR, file), 'utf8'),
    }));
}

function declaredName(workflow: WorkflowFile): string | undefined {
  const raw = workflow.content.match(/^name:(.*)$/m)?.[1]?.trim();
  return raw?.replace(/^['"]|['"]$/g, '');
}

/**
 * Extract the workflow names referenced by an `on.workflow_run.workflows` list.
 * Line-based parse (no backtracking-prone regex): handles inline arrays
 * (`workflows: ['PR CI']`) and block lists; comment lines are skipped so prose
 * mentioning quoted names cannot leak in.
 */
function referencedWorkflowRunNames(workflow: WorkflowFile): string[] {
  const lines = workflow.content.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  const quoted = (line: string): string[] =>
    [...line.matchAll(/['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name));

  const names: string[] = [];
  let inWorkflowRun = false;
  let inWorkflowsList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'workflow_run:') {
      inWorkflowRun = true;
      continue;
    }
    if (!inWorkflowRun) continue;
    if (trimmed.startsWith('workflows:')) {
      names.push(...quoted(trimmed));
      inWorkflowsList = !trimmed.includes('[');
      continue;
    }
    if (inWorkflowsList && trimmed.startsWith('- ')) {
      names.push(...quoted(trimmed));
      continue;
    }
    // Any other key (types:, another trigger, …) ends the block.
    inWorkflowsList = false;
    if (trimmed.endsWith(':')) inWorkflowRun = false;
  }
  return names;
}

// A workflow_run trigger referencing a workflow name that no longer exists
// NEVER fires and GitHub never warns. This bit core-fe: dependabot-ci-triage
// and cleanup-cache silently listened for the old 'CI' name for weeks after
// the PR workflow was renamed to 'PR CI'. Ported from core-fe so a rename
// here fails the unit lane instead of silently killing triggers.
describe('workflow_run trigger policy', () => {
  const workflows = loadWorkflows();
  const declaredNames = new Set(
    workflows.map((workflow) => declaredName(workflow)).filter(Boolean),
  );

  it('every workflow declares a top-level name', () => {
    for (const workflow of workflows) {
      expect(declaredName(workflow), `${workflow.file} has no top-level name:`).toBeTruthy();
    }
  });

  it('every workflow_run reference matches the name: of an existing workflow', () => {
    const references = workflows.flatMap((workflow) =>
      referencedWorkflowRunNames(workflow).map((name) => ({
        file: workflow.file,
        name,
      })),
    );
    // Guard the extractor itself: this repo is known to wire workflow_run
    // triggers (cleanup-cache, dependabot-ci-triage) — zero extracted
    // references means the parser broke, not that the repo has none.
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(
        declaredNames.has(reference.name),
        `${reference.file} listens for workflow_run of '${reference.name}', but no workflow declares that name — the trigger never fires. Existing names: ${[...declaredNames].join(', ')}`,
      ).toBe(true);
    }
  });
});
