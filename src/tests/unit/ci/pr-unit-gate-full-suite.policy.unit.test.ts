import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the PR-gate under-selection bug.
 *
 * The PR unit lane (`reusable-vitest-unit-only.yml`) used to run `vitest --changed origin/dev`,
 * which selects only tests the import graph links to changed files. When a source change broke an
 * EXISTING test whose linkage wasn't detected (e.g. `.js` path-alias imports not resolving to the
 * changed `.ts`), the break passed the PR gate and only failed post-merge — this is exactly how a
 * notification-preferences service guard (#327) and a permission-route-matrix change (#311) reached
 * dev red. The fix is to run the COMPLETE unit + global suite on the gate so any regression to an
 * existing test fails the PR, not dev.
 *
 * This test fails if anyone reintroduces `--changed`/`--passWithNoTests` on the gate, or drops a
 * project from the full-suite invocation.
 */
const unitGateWorkflowPath = join(process.cwd(), '.github/workflows/reusable-vitest-unit-only.yml');
const prCiWorkflowPath = join(process.cwd(), '.github/workflows/pr-ci.yml');

/**
 * Strip comment lines (`# ...`) and step `name:` labels so assertions target the executable
 * command, not the explanatory prose (the header comment and step name legitimately mention
 * `--changed` to document why it is forbidden).
 */
function executableLinesOf(workflowText: string): string {
  return workflowText
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .filter((line) => !/^\s*(- )?name:/.test(line))
    .join('\n');
}

describe('PR unit gate runs the full suite (no --changed under-selection)', () => {
  const unitGateWorkflow = readFileSync(unitGateWorkflowPath, 'utf8');
  const executable = executableLinesOf(unitGateWorkflow);

  it('invokes the complete unit + global Vitest projects', () => {
    expect(executable).toContain('vitest run');
    expect(executable).toContain('--project unit');
    expect(executable).toContain('--project global');
  });

  it('does NOT use `vitest --changed` import-graph selection on the gate', () => {
    // The only mentions of `--changed` must be in the header comment / step name (both stripped
    // above). If it survives into the executable command, the under-selection bug is back.
    expect(executable).not.toContain('--changed');
  });

  it('does NOT pass `--passWithNoTests` (an empty selection must fail the gate, not pass it)', () => {
    expect(executable).not.toContain('--passWithNoTests');
  });

  it('no longer threads a base-ref input (only needed for --changed)', () => {
    expect(executable).not.toContain('base-ref');
  });

  it('is the workflow the PR CI unit job delegates to', () => {
    const prCi = readFileSync(prCiWorkflowPath, 'utf8');
    expect(prCi).toContain('uses: ./.github/workflows/reusable-vitest-unit-only.yml');
    // The caller must not pass the removed base-ref input.
    expect(executableLinesOf(prCi)).not.toContain('base-ref');
  });
});
