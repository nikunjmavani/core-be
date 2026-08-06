import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vitestProjects } from '@tooling/vitest/projects.js';
import { LANES } from '@tooling/vitest/lanes.js';

/**
 * Policy: any set of Vitest projects launched in ONE process must agree on
 * `maxWorkers`.
 *
 * No project sets an explicit `sequence.groupOrder`, so every project shares the
 * default group. Vitest refuses to start when two projects in the same group
 * disagree on `maxWorkers` ("Projects X and Y have different 'maxWorkers' but
 * same 'sequence.groupOrder'"), and it fails as an *unhandled error* before any
 * file runs — the lane reports "no tests" rather than a failure anyone reads as
 * a config bug.
 *
 * This bit `pnpm test` / `pnpm test:fast`: `property` was added to the fast lane
 * without the `maxWorkers: '50%'` that `unit` and `global` carry, so the whole
 * parallel tier ran zero tests. The groupings below are derived from the real
 * launchers (package.json scripts + the parallel driver's lanes), so a new
 * project — or a new multi-project script — is covered the moment it is added.
 */

/** Projects that a single vitest process is asked to run together. */
interface ProjectGrouping {
  source: string;
  projects: string[];
}

/** Extracts `--project a --project b` sequences from a shell command / arg list. */
function projectsFromArgs(tokens: readonly string[]): string[] {
  const projects: string[] = [];
  tokens.forEach((token, index) => {
    if (token === '--project') {
      const name = tokens[index + 1];
      if (name !== undefined) projects.push(name);
    }
  });
  return projects;
}

function collectGroupings(): ProjectGrouping[] {
  const groupings: ProjectGrouping[] = [];

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    const projects = projectsFromArgs(command.split(/\s+/));
    if (projects.length > 1) groupings.push({ source: `package.json script "${name}"`, projects });
  }

  for (const lane of LANES) {
    const projects = projectsFromArgs(lane.args);
    // A serial lane splits into one process per project, so its members never share a process.
    if (projects.length > 1 && lane.serial !== true) {
      groupings.push({ source: `run-parallel lane "${lane.name}"`, projects });
    }
  }

  return groupings;
}

/** `maxWorkers` as configured for a project name (undefined = Vitest default). */
function maxWorkersByProject(): Map<string, unknown> {
  const byName = new Map<string, unknown>();
  for (const project of vitestProjects) {
    const test = (project as { test?: { name?: string; maxWorkers?: unknown } }).test;
    if (test?.name !== undefined) byName.set(test.name, test.maxWorkers);
  }
  return byName;
}

describe('Global: vitest project grouping', () => {
  const groupings = collectGroupings();
  const maxWorkers = maxWorkersByProject();

  it('finds the multi-project launchers it is meant to guard', () => {
    expect(groupings.length).toBeGreaterThan(0);
    expect(groupings.some((grouping) => grouping.projects.includes('property'))).toBe(true);
  });

  it('names only projects that exist in the vitest config', () => {
    for (const { source, projects } of groupings) {
      for (const project of projects) {
        expect(maxWorkers.has(project), `${source} names unknown project "${project}"`).toBe(true);
      }
    }
  });

  it('runs no two projects with different maxWorkers in one process', () => {
    for (const { source, projects } of groupings) {
      const distinct = [...new Set(projects.map((project) => maxWorkers.get(project)))];
      expect(
        distinct.length,
        `${source} runs [${projects.join(', ')}] in one vitest process, but their maxWorkers differ ` +
          `(${projects.map((project) => `${project}=${String(maxWorkers.get(project))}`).join(', ')}). ` +
          'Vitest aborts the run before any test executes — give them the same maxWorkers.',
      ).toBe(1);
    }
  });
});
