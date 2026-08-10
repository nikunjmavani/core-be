#!/usr/bin/env tsx
/**
 * Parallel test driver — runs the parallel-safe Vitest projects (`fast`) and
 * the DB-bound projects (`db-bound`) in two concurrent processes, then waits
 * for both to finish.
 *
 * Wall-clock time = max(fast tier, db-bound tier) instead of sum.
 *
 * Use locally to verify CI parallelism ergonomics. CI uses a matrix split
 * (`.github/workflows/reusable-vitest-postgres-redis.yml`) with the same project
 * filters so each shard runs on its own runner.
 *
 * Usage:
 *   pnpm test:parallel               # tests only, no coverage
 *   pnpm test:parallel -- --coverage # tests + per-lane coverage + merged gate
 *
 * Coverage mode mirrors the CI `coverage-gate` job exactly: each lane writes
 * a shard-scoped report (`coverage-fast/`, `coverage-db-bound/`), thresholds
 * are disabled per shard, and after both shards finish the shared merge
 * script (`tooling/ci/merge-coverage-and-check-thresholds.mjs`) merges the
 * shard JSONs and enforces the thresholds from
 * `tooling/ci/coverage-thresholds.json`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { LANES, type Lane } from '@tooling/vitest/lanes.js';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME } from '@tooling/route-coverage/constants.js';

/** One lane's outcome: its display name, process exit code, and wall-clock duration. */
export type LaneResult = { name: string; code: number; ms: number };

const COVERAGE_FLAG = '--coverage';
const COVERAGE_DISABLE_THRESHOLD_FLAGS = [
  '--coverage.thresholds.lines=0',
  '--coverage.thresholds.functions=0',
  '--coverage.thresholds.statements=0',
  '--coverage.thresholds.branches=0',
];

const passthroughArgs = process.argv.slice(2);
const coverageEnabled = passthroughArgs.includes(COVERAGE_FLAG);

function buildLaneArgs(lane: Lane): string[] {
  if (!coverageEnabled) return lane.args;
  return [
    ...lane.args,
    COVERAGE_FLAG,
    `--coverage.reportsDirectory=coverage-${lane.name}`,
    ...COVERAGE_DISABLE_THRESHOLD_FLAGS,
  ];
}

function splitSerialProjectArgs(lane: Lane): string[][] {
  if (!lane.serial) return [buildLaneArgs(lane)];

  const command = lane.args[0] ?? 'run';
  const projects: string[] = [];
  for (let index = 0; index < lane.args.length; index += 1) {
    const project = lane.args[index + 1];
    if (lane.args[index] === '--project' && project) {
      projects.push(project);
    }
  }
  if (projects.length === 0) return [buildLaneArgs(lane)];

  return projects.map((project) => {
    const args = [command, '--project', project];
    if (!coverageEnabled) return args;
    return [
      ...args,
      COVERAGE_FLAG,
      `--coverage.reportsDirectory=coverage-${lane.name}-${project}`,
      ...COVERAGE_DISABLE_THRESHOLD_FLAGS,
    ];
  });
}

function runChild(
  prefix: string,
  command: string,
  commandArgs: string[],
): Promise<{ code: number; ms: number }> {
  return new Promise((resolvePromise) => {
    const start = performance.now();
    process.stdout.write(`${prefix} starting: ${command} ${commandArgs.join(' ')}\n`);

    const child: ChildProcess = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    const tagStream = (chunk: Buffer, write: (s: string) => void): void => {
      const lines = chunk.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (i === lines.length - 1 && line === '') continue;
        write(`${prefix} ${line}\n`);
      }
    };

    child.stdout?.on('data', (data: Buffer) => tagStream(data, (s) => process.stdout.write(s)));
    child.stderr?.on('data', (data: Buffer) => tagStream(data, (s) => process.stderr.write(s)));

    child.on('close', (code) => {
      const ms = performance.now() - start;
      resolvePromise({ code: code ?? 1, ms });
    });
  });
}

async function runLane(lane: Lane): Promise<LaneResult[]> {
  const results: LaneResult[] = [];
  const serialArgs = splitSerialProjectArgs(lane);

  for (const args of serialArgs) {
    const projectName = lane.serial
      ? (args[args.indexOf('--project') + 1] ?? lane.name)
      : lane.name;
    const result = await runChild(`[${lane.name}]`, 'pnpm', ['exec', 'vitest', ...args]);
    results.push({ name: lane.serial ? `${lane.name}:${projectName}` : lane.name, ...result });
    if (result.code !== 0) break;
  }

  return results;
}

async function runMergedCoverageGate(): Promise<number> {
  const shardInputs = LANES.flatMap((lane) => {
    if (!lane.serial) return [`coverage-${lane.name}/coverage-final.json`];
    const projectArgs = splitSerialProjectArgs(lane);
    return projectArgs.map((args) => {
      const projectName = args[args.indexOf('--project') + 1] ?? lane.name;
      return `coverage-${lane.name}-${projectName}/coverage-final.json`;
    });
  });
  const mergeScript = resolve(process.cwd(), 'tooling/ci/merge-coverage-and-check-thresholds.mjs');
  const args = [mergeScript, ...shardInputs, '--output', 'coverage/coverage-final.json'];
  const result = await runChild('[coverage-gate]', process.execPath, args);
  return result.code;
}

/**
 * Renders the end-of-run lane table, including the exit code the process will actually use.
 *
 * @remarks
 * **Why it is a function:** the total row previously hardcoded `exit=0`, so a run whose
 * `integration` lane read `exit=1` still printed `total (wall) … exit=0` on the line directly
 * beneath it — the one line a human scans first. The process exit was always correct; only
 * the summary lied. Exported so that stays pinned by a test rather than by eyeballing.
 *
 * **Notes:** lanes run in sequence and the caller stops at the first failure, so lanes after
 * it never run and have no row. The trailing note says so, rather than leaving a reader to
 * conclude a lane silently vanished.
 */
export function formatRunSummary(results: readonly LaneResult[], overallMs: number): string {
  const widestName = Math.max(...results.map((result) => result.name.length));
  const formatLine = (name: string, ms: number, code: number): string =>
    `${name.padEnd(widestName)}  ${(ms / 1000).toFixed(1).padStart(7)}s  exit=${code}`;

  const failedLane = results.find((result) => result.code !== 0);
  const lines = [
    '\n────────── parallel test summary ──────────',
    ...results.map((result) => formatLine(result.name, result.ms, result.code)),
    formatLine('total (wall)', overallMs, failedLane?.code ?? 0),
  ];

  if (failedLane) {
    lines.push(
      `\nStopped after the first failing lane (${failedLane.name}); later lanes did not run.`,
    );
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const overallStart = performance.now();
  const results: LaneResult[] = [];

  // Full-run start: drop stale route-status observations so
  // `pnpm validate:route-success-coverage` only credits this run.
  rmSync(resolve(process.cwd(), ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME), {
    recursive: true,
    force: true,
  });

  for (const lane of LANES) {
    const laneResults = await runLane(lane);
    results.push(...laneResults);
    if (laneResults.some((result) => result.code !== 0)) {
      break;
    }
  }

  const overallMs = performance.now() - overallStart;

  const failedLane = results.find((result) => result.code !== 0);
  process.stdout.write(formatRunSummary(results, overallMs));

  if (failedLane) {
    process.exit(failedLane.code);
  }

  if (coverageEnabled) {
    const mergeExitCode = await runMergedCoverageGate();
    if (mergeExitCode !== 0) {
      process.exit(mergeExitCode);
    }
  }
}

// Guarded so a test can import `formatRunSummary` without the import launching the entire
// test suite as a side effect. Matches tooling/agent-os/skills-lock.ts.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
