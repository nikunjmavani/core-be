/**
 * Lane definitions for the parallel test driver (`run-parallel.ts`).
 *
 * Split out of the driver so tests can read the lanes without importing that
 * module — `run-parallel.ts` invokes `main()` at import time, so importing it
 * from a test would spawn the whole test matrix recursively.
 */

/** One vitest invocation: a named set of CLI args, optionally run project-by-project. */
type Lane = {
  name: string;
  args: string[];
  /** Lanes that run sequentially together — useful when DB cleanup races would happen across forks. */
  serial?: boolean;
};

export type { Lane };

export const LANES: Lane[] = [
  /**
   * Parallel-safe: pure-unit, property, global — files run concurrently inside Vitest.
   * No shared Postgres cleanup.
   */
  {
    name: 'fast',
    args: ['run', '--project', 'unit', '--project', 'property', '--project', 'global'],
  },
  /**
   * DB-bound: unit-db, e2e, integration, security, performance.
   * Each project enforces serial file execution; lanes run after `fast` so a single
   * local Postgres is not hammered by two processes at once.
   */
  {
    name: 'db-bound',
    args: [
      'run',
      '--project',
      'unit-db',
      '--project',
      'e2e',
      '--project',
      'integration',
      '--project',
      'security',
      '--project',
      'performance',
    ],
    serial: true,
  },
];
