/**
 * Autocannon-driven micro-benchmark runner — the suite `bench.overview.md` always
 * described. Benches a fixed endpoint matrix against a LIVE local server
 * (`pnpm dev` first), prints a p50/p95/p99 + req/s table, and exits non-zero only
 * when an endpoint is BROKEN (zero 2xx) — latency numbers stay informational, as
 * micro-benchmarks on a developer machine should.
 *
 * Usage:
 *   pnpm test:bench                       # full matrix, 10 connections × 10s each
 *   pnpm test:bench --only readyz         # one endpoint
 *   pnpm test:bench --duration 30         # longer runs
 *   pnpm test:bench --json                # machine-readable summary
 *
 * Authenticated endpoints log in with `DEMO_EMAIL` / `DEMO_PASSWORD` (the same
 * defaults as smoke and k6); when login fails they are SKIPPED with a notice so
 * the public benches still run on an unseeded server.
 *
 * Autocannon is spawned via `npx --yes autocannon` (downloaded on demand) to keep
 * it out of the dependency tree — the same stance the previous one-liner
 * `test:bench` script took.
 */
import { spawnSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const API_PREFIX = `${BASE_URL}/api/v1`;

/** One benchmark target: a name, a URL, and whether it needs a Bearer token. */
export interface BenchEndpoint {
  name: string;
  url: string;
  requiresAuth: boolean;
  description: string;
  /**
   * Total-request cap (`autocannon -a`) instead of a duration run. Rate-limited API
   * routes need it: even the RELAXED local per-IP window (5000/60s) saturates in a
   * seconds-long duration burst, after which the bench measures fast 429s instead of
   * the route — latency skews DOWN and non-2xx explodes. Capped below the window,
   * every sampled request is a real 2xx.
   */
  requestCap?: number;
}

/** The fixed endpoint matrix — the platform's hottest read paths, one per tier. */
export const BENCH_ENDPOINTS: readonly BenchEndpoint[] = [
  {
    name: 'readyz',
    url: `${BASE_URL}/readyz`,
    requiresAuth: false,
    description: 'readiness probe (no DB beyond health pings)',
  },
  {
    name: 'plans-public',
    url: `${API_PREFIX}/billing/plans`,
    requiresAuth: false,
    description: 'public DB-backed list (billing catalog)',
    requestCap: 4000,
  },
  {
    name: 'users-me',
    url: `${API_PREFIX}/users/me`,
    requiresAuth: true,
    description: 'authed hot path (JWT verify + user read)',
    // Authed routes ride actor-keyed windows of ~100/min even locally — both
    // authed rows must fit ONE window together, so ~45 samples each. Small, but
    // a p50/p95 tripwire needs dozens of samples, not thousands.
    requestCap: 45,
  },
  {
    name: 'memberships-permission-cached',
    url: `${API_PREFIX}/tenancy/organization/memberships`,
    requiresAuth: true,
    description: 'organization-scoped read through the Redis permission cache',
    requestCap: 45,
  },
];

/** Slice of autocannon's `--json` output this runner consumes. */
export interface AutocannonJsonSummary {
  latency?: Record<string, number>;
  requests?: { average?: number };
  '2xx'?: number;
  non2xx?: number;
  errors?: number;
}

/** One formatted result row for the summary table (latencies in ms). */
export interface BenchResultRow {
  name: string;
  p50: number;
  p95: number;
  p99: number;
  requestsPerSecond: number;
  ok2xx: number;
  non2xx: number;
  skipped?: string;
}

/**
 * Maps an autocannon JSON summary onto a table row. Autocannon names its latency
 * percentile keys `p50` / `p97_5` / `p99` (no plain p95), so p95 falls back
 * through `p97_5` — close enough for a tripwire and clearly labeled.
 */
export function summarizeAutocannonRun(
  name: string,
  summary: AutocannonJsonSummary,
): BenchResultRow {
  const latency = summary.latency ?? {};
  const p95 = latency.p95 ?? latency.p97_5 ?? latency.p90 ?? 0;
  return {
    name,
    p50: latency.p50 ?? 0,
    p95,
    p99: latency.p99 ?? 0,
    requestsPerSecond: summary.requests?.average ?? 0,
    ok2xx: summary['2xx'] ?? 0,
    non2xx: summary.non2xx ?? 0,
  };
}

/** Renders the result rows as an aligned plain-text table. */
export function formatBenchTable(rows: readonly BenchResultRow[]): string {
  const header = ['endpoint', 'p50 ms', 'p95 ms', 'p99 ms', 'req/s', '2xx', 'non-2xx'];
  const body = rows.map((row) =>
    row.skipped
      ? [row.name, `— skipped: ${row.skipped}`, '', '', '', '', '']
      : [
          row.name,
          String(row.p50),
          String(row.p95),
          String(row.p99),
          row.requestsPerSecond.toFixed(1),
          String(row.ok2xx),
          String(row.non2xx),
        ],
  );
  const widths = header.map((_, columnIndex) =>
    Math.max(header[columnIndex]!.length, ...body.map((row) => (row[columnIndex] ?? '').length)),
  );
  const renderLine = (cells: readonly string[]) =>
    cells.map((cell, index) => (cell ?? '').padEnd(widths[index]!)).join('  ');
  return [renderLine(header), renderLine(widths.map((width) => '─'.repeat(width)))]
    .concat(body.map(renderLine))
    .join('\n');
}

/** Parsed CLI flags for one runner invocation. */
export interface BenchCliOptions {
  duration: number;
  connections: number;
  only?: string;
  json: boolean;
}

/** Parses `--duration/--connections/--only/--json` (defaults 10s / 10c / all / table). */
export function parseBenchCliOptions(argv: readonly string[]): BenchCliOptions {
  const options: BenchCliOptions = { duration: 10, connections: 10, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--duration') options.duration = Number(argv[index + 1] ?? options.duration);
    if (flag === '--connections')
      options.connections = Number(argv[index + 1] ?? options.connections);
    if (flag === '--only') {
      const onlyValue = argv[index + 1];
      if (onlyValue !== undefined) options.only = onlyValue;
    }
    if (flag === '--json') options.json = true;
  }
  return options;
}

/** Logs in with the demo credentials and returns a Bearer token, or null. */
async function loginForBearerToken(): Promise<string | null> {
  const email = process.env.DEMO_EMAIL ?? 'demo@example.com';
  const password = process.env.DEMO_PASSWORD ?? 'DemoPassword123!';
  try {
    const response = await fetch(`${API_PREFIX}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { access_token?: string } };
    return body.data?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Spawns one `npx autocannon --json` run and parses its summary. */
function runAutocannon(
  endpoint: BenchEndpoint,
  options: BenchCliOptions,
  bearerToken: string | null,
): AutocannonJsonSummary {
  const args = ['--yes', 'autocannon', '--json', '-c', String(options.connections)];
  if (endpoint.requestCap !== undefined) {
    args.push('-a', String(endpoint.requestCap));
  } else {
    args.push('-d', String(options.duration));
  }
  if (endpoint.requiresAuth && bearerToken) {
    args.push('-H', `Authorization: Bearer ${bearerToken}`);
  }
  args.push(endpoint.url);

  const spawned = spawnSync('npx', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (spawned.status !== 0 || !spawned.stdout) {
    throw new Error(
      `autocannon failed for ${endpoint.name}: ${spawned.stderr?.slice(0, 300) ?? 'no output'}`,
    );
  }
  return JSON.parse(spawned.stdout) as AutocannonJsonSummary;
}

/** Runs the matrix and returns rows + the process exit code (1 = an endpoint is broken). */
async function runBenchSuite(): Promise<number> {
  const options = parseBenchCliOptions(process.argv.slice(2));
  const selectedEndpoints = BENCH_ENDPOINTS.filter(
    (endpoint) => !options.only || endpoint.name === options.only,
  );
  if (selectedEndpoints.length === 0) {
    process.stderr.write(
      `unknown --only value; endpoints: ${BENCH_ENDPOINTS.map((endpoint) => endpoint.name).join(', ')}\n`,
    );
    return 1;
  }

  const needsAuth = selectedEndpoints.some((endpoint) => endpoint.requiresAuth);
  const bearerToken = needsAuth ? await loginForBearerToken() : null;

  const rows: BenchResultRow[] = [];
  let brokenEndpointCount = 0;
  for (const endpoint of selectedEndpoints) {
    if (endpoint.requiresAuth && !bearerToken) {
      rows.push({
        name: endpoint.name,
        p50: 0,
        p95: 0,
        p99: 0,
        requestsPerSecond: 0,
        ok2xx: 0,
        non2xx: 0,
        skipped: 'login failed (server down or demo user unseeded)',
      });
      continue;
    }
    process.stderr.write(`↻ bench ${endpoint.name} — ${endpoint.description}\n`);
    const row = summarizeAutocannonRun(
      endpoint.name,
      runAutocannon(endpoint, options, bearerToken),
    );
    if (row.ok2xx === 0) brokenEndpointCount += 1;
    rows.push(row);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else {
    process.stdout.write(`\n${formatBenchTable(rows)}\n\n`);
    process.stdout.write('latency numbers are informational; the gate only fails on zero 2xx.\n');
  }
  return brokenEndpointCount > 0 ? 1 : 0;
}

const isDirectCliInvocation =
  process.argv[1]?.endsWith('run-benches.ts') || process.argv[1]?.endsWith('run-benches.js');
if (isDirectCliInvocation) {
  runBenchSuite().then(
    (exitCode) => process.exit(exitCode),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
