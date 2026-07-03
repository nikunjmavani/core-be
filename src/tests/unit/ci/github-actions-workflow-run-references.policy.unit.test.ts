import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const WORKFLOWS_DIR = join(ROOT, '.github/workflows');

/**
 * `on.workflow_run.workflows` entries match workflows by their display `name:`,
 * not by file name. Renaming a workflow's `name:` silently kills every trigger
 * that references the old name — the dependent workflow simply never runs again
 * (no error, no failed check). This policy test makes every reference resolve
 * against the current set of workflow names so a rename breaks CI loudly instead.
 */

function listWorkflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .map((fileName) => join(WORKFLOWS_DIR, fileName));
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractWorkflowName(contents: string): string | undefined {
  const match = contents.match(/^name:\s*(.+)$/m);
  return match ? stripQuotes(match[1]!) : undefined;
}

function extractWorkflowRunReferences(contents: string): string[] {
  const references: string[] = [];
  const lines = contents.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (!/^\s*workflow_run:\s*$/.test(lines[lineIndex]!)) {
      continue;
    }
    for (let blockIndex = lineIndex + 1; blockIndex < lines.length; blockIndex++) {
      const line = lines[blockIndex]!;
      const inlineList = line.match(/^\s*workflows:\s*\[(.+)\]\s*$/);
      if (inlineList) {
        for (const rawEntry of inlineList[1]!.split(',')) {
          references.push(stripQuotes(rawEntry));
        }
        break;
      }
      if (/^\s*workflows:\s*$/.test(line)) {
        for (let itemIndex = blockIndex + 1; itemIndex < lines.length; itemIndex++) {
          const listItem = lines[itemIndex]!.match(/^\s*-\s*(.+?)\s*$/);
          if (!listItem) {
            break;
          }
          references.push(stripQuotes(listItem[1]!));
        }
        break;
      }
      // Left the trigger block without finding a workflows list.
      if (/^\S/.test(line)) {
        break;
      }
    }
  }
  return references;
}

describe('GitHub Actions workflow_run reference policy', () => {
  it('every workflow_run trigger references an existing workflow name', () => {
    const workflowFiles = listWorkflowFiles();
    const workflowNames = new Set(
      workflowFiles
        .map((filePath) => extractWorkflowName(readFileSync(filePath, 'utf8')))
        .filter((name): name is string => Boolean(name)),
    );

    let totalReferences = 0;
    for (const filePath of workflowFiles) {
      const references = extractWorkflowRunReferences(readFileSync(filePath, 'utf8'));
      totalReferences += references.length;
      for (const reference of references) {
        expect(
          workflowNames.has(reference),
          `${filePath} references workflow_run trigger "${reference}", which matches no workflow name — the dependent workflow would silently never run`,
        ).toBe(true);
      }
    }

    // Parser self-check: this repo uses workflow_run triggers (cleanup-cache,
    // dependabot-ci-triage). Zero extracted references means the parser broke,
    // not that the triggers disappeared — fail loudly either way.
    expect(totalReferences).toBeGreaterThan(0);
  });
});
