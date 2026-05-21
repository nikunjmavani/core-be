#!/usr/bin/env tsx
/**
 * Parallel test driver — runs the parallel-safe Vitest projects (`fast`) and
 * the DB-bound projects (`db-bound`) in two concurrent processes, then waits
 * for both to finish.
 *
 * Wall-clock time = max(fast tier, db-bound tier) instead of sum.
 *
 * Use locally to verify CI parallelism ergonomics. CI uses a matrix split
 * (`.github/workflows/reusable/test-with-db.yml`) with the same project
 * filters so each shard runs on its own runner.
 *
 * Usage: `pnpm test:parallel`
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';

type Lane = {
  name: string;
  args: string[];
  /** Lanes that run sequentially together — useful when DB cleanup races would happen across forks. */
  serial?: boolean;
};

const LANES: Lane[] = [
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

function runLane(lane: Lane): Promise<{ name: string; code: number; ms: number }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const prefix = `[${lane.name}]`;
    process.stdout.write(`${prefix} starting: vitest ${lane.args.join(' ')}\n`);

    const child: ChildProcess = spawn('pnpm', ['exec', 'vitest', ...lane.args], {
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
      resolve({ name: lane.name, code: code ?? 1, ms });
    });
  });
}

async function main(): Promise<void> {
  const overallStart = performance.now();
  const results: Array<{ name: string; code: number; ms: number }> = [];

  for (const lane of LANES) {
    const result = await runLane(lane);
    results.push(result);
    if (result.code !== 0) {
      break;
    }
  }

  const overallMs = performance.now() - overallStart;

  const widestName = Math.max(...results.map((r) => r.name.length));
  const formatLine = (name: string, ms: number, code: number): string =>
    `${name.padEnd(widestName)}  ${(ms / 1000).toFixed(1).padStart(7)}s  exit=${code}`;

  process.stdout.write('\n────────── parallel test summary ──────────\n');
  for (const result of results) {
    process.stdout.write(`${formatLine(result.name, result.ms, result.code)}\n`);
  }
  process.stdout.write(`${formatLine('total (wall)', overallMs, 0)}\n`);

  const failed = results.find((r) => r.code !== 0);
  if (failed) {
    process.exit(failed.code);
  }
}

void main();
