#!/usr/bin/env tsx
/**
 * `pnpm setup:local` — one-command local bootstrap.
 *
 * Idempotent end-to-end flow: preflight → dependencies → env scaffolding →
 * Docker (postgres + redis) → migrations → optional seed/worker/toxiproxy →
 * start `pnpm dev`. Every phase is re-run safe: each step checks its own
 * "already done" state and reports "skipped".
 *
 * Usage:
 *   pnpm setup:local
 *   pnpm setup:local --seed minimal
 *   pnpm setup:local --seed full --with-worker
 *   pnpm setup:local --with-toxiproxy
 *   pnpm setup:local --no-start                 (bootstrap only, skip dev)
 *   pnpm setup:local --check                    (preflight only, no mutations)
 *   pnpm setup:local --skip-deps --skip-docker  (granular skips)
 *
 * Designed to never overwrite real credentials. If `.env.development` already
 * exists, it is left untouched; if `.env.local` already exists, it is left
 * untouched. Use `--force-env-local` to rewrite `.env.local` from the canonical
 * localhost template.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const PROJECT_ROOT = process.cwd();
const REQUIRED_NODE_MAJOR = 24;
const POSTGRES_CONTAINER = 'core-be-postgres';
const REDIS_CONTAINER = 'core-be-redis';
const DEFAULT_DEV_PORT = 3000;

type StepStatus = 'done' | 'skipped' | 'warning' | 'failed';

interface StepReport {
  phase: string;
  status: StepStatus;
  detail?: string;
  elapsedMs: number;
}

interface BootstrapOptions {
  check: boolean;
  noStart: boolean;
  skipDeps: boolean;
  skipDocker: boolean;
  skipMigrate: boolean;
  forceEnvLocal: boolean;
  seed: 'none' | 'minimal' | 'full';
  withWorker: boolean;
  withToxiproxy: boolean;
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

function symbolForStatus(status: StepStatus): string {
  switch (status) {
    case 'done':
      return `${ANSI.green}✓${ANSI.reset}`;
    case 'skipped':
      return `${ANSI.gray}○${ANSI.reset}`;
    case 'warning':
      return `${ANSI.yellow}!${ANSI.reset}`;
    case 'failed':
      return `${ANSI.red}✗${ANSI.reset}`;
  }
}

function logInfo(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

function logHeading(message: string): void {
  process.stdout.write(`\n${ANSI.bold}${ANSI.cyan}${message}${ANSI.reset}\n`);
}

function logBanner(): void {
  const line = '═'.repeat(58);
  process.stdout.write(`\n╔${line}╗\n`);
  process.stdout.write(
    `║  ${ANSI.bold}core-be — local bootstrap (pnpm setup:local)${ANSI.reset}            ║\n`,
  );
  process.stdout.write(`║  Docker + env + migrate + dev in one command             ║\n`);
  process.stdout.write(`╚${line}╝\n`);
}

function reportStep(
  reports: StepReport[],
  phase: string,
  status: StepStatus,
  startedAtMs: number,
  detail?: string,
): void {
  const elapsedMs = Math.round(performance.now() - startedAtMs);
  reports.push({ phase, status, detail, elapsedMs });
  const elapsedLabel = elapsedMs < 100 ? '' : `${ANSI.dim}(${elapsedMs}ms)${ANSI.reset}`;
  const detailLabel = detail ? ` ${ANSI.dim}— ${detail}${ANSI.reset}` : '';
  process.stdout.write(`  ${symbolForStatus(status)} ${phase}${detailLabel} ${elapsedLabel}\n`);
}

function parseArgs(): BootstrapOptions {
  const argv = process.argv.slice(2);
  const has = (flag: string): boolean => argv.includes(flag);
  const valueForFlag = (flag: string): string | undefined => {
    const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const positional = argv.indexOf(flag);
    if (positional >= 0) {
      const next = argv[positional + 1];
      if (next && !next.startsWith('--')) return next;
    }
    return undefined;
  };

  const rawSeed = valueForFlag('--seed');
  let seed: BootstrapOptions['seed'] = 'none';
  if (has('--seed') && rawSeed === undefined) seed = 'minimal';
  else if (rawSeed === 'minimal' || rawSeed === 'full') seed = rawSeed;
  else if (rawSeed !== undefined) {
    process.stderr.write(`Invalid --seed value: ${rawSeed}. Expected minimal | full.\n`);
    process.exit(2);
  }

  return {
    check: has('--check'),
    noStart: has('--no-start'),
    skipDeps: has('--skip-deps'),
    skipDocker: has('--skip-docker'),
    skipMigrate: has('--skip-migrate'),
    forceEnvLocal: has('--force-env-local'),
    seed,
    withWorker: has('--with-worker'),
    withToxiproxy: has('--with-toxiproxy'),
  };
}

function runCommand(
  command: string,
  args: string[],
  silent = false,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function captureCommand(
  command: string,
  args: string[],
): { code: number; stdout: string; stderr: string } {
  return runCommand(command, args, true);
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const tester = createServer()
      .once('error', () => resolvePromise(true))
      .once('listening', () => {
        tester.close(() => resolvePromise(false));
      })
      .listen(port, '127.0.0.1');
  });
}

interface ContainerState {
  exists: boolean;
  running: boolean;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown';
}

function inspectContainer(name: string): ContainerState {
  const result = captureCommand('docker', [
    'inspect',
    '--format',
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
    name,
  ]);
  if (result.code !== 0) return { exists: false, running: false, health: 'none' };
  const [status = '', health = 'unknown'] = result.stdout.trim().split('|');
  return {
    exists: true,
    running: status === 'running',
    health: (health || 'unknown') as ContainerState['health'],
  };
}

function runPreflight(reports: StepReport[]): void {
  logHeading('1/8 Preflight');

  const nodeStartedAt = performance.now();
  const nodeMajor = Number(process.versions.node.split('.')[0] ?? 0);
  if (Number.isNaN(nodeMajor) || nodeMajor < REQUIRED_NODE_MAJOR) {
    reportStep(
      reports,
      `Node ${process.versions.node}`,
      'failed',
      nodeStartedAt,
      `requires Node >= ${REQUIRED_NODE_MAJOR} (engines.node)`,
    );
    process.exit(1);
  }
  reportStep(reports, `Node ${process.versions.node}`, 'done', nodeStartedAt);

  const pnpmStartedAt = performance.now();
  const pnpmVersionResult = captureCommand('pnpm', ['--version']);
  if (pnpmVersionResult.code !== 0) {
    reportStep(
      reports,
      'pnpm CLI',
      'failed',
      pnpmStartedAt,
      'pnpm not found — install via corepack enable && corepack prepare pnpm@latest --activate',
    );
    process.exit(1);
  }
  const installedPnpm = pnpmVersionResult.stdout.trim();
  let pnpmDetail = `v${installedPnpm}`;
  let pnpmStatus: StepStatus = 'done';
  const latestPnpm = fetchLatestPnpmVersion();
  if (latestPnpm && installedPnpm !== latestPnpm) {
    pnpmDetail = `v${installedPnpm} — newer v${latestPnpm} available (corepack prepare pnpm@${latestPnpm} --activate)`;
    pnpmStatus = 'warning';
  }
  reportStep(reports, 'pnpm CLI', pnpmStatus, pnpmStartedAt, pnpmDetail);

  const dockerStartedAt = performance.now();
  const dockerInfo = captureCommand('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (dockerInfo.code !== 0) {
    reportStep(
      reports,
      'Docker daemon',
      'failed',
      dockerStartedAt,
      'Docker daemon is not reachable — start Docker Desktop / OrbStack first',
    );
    process.exit(1);
  }
  reportStep(
    reports,
    'Docker daemon',
    'done',
    dockerStartedAt,
    `engine ${dockerInfo.stdout.trim()}`,
  );
}

function fetchLatestPnpmVersion(): string | null {
  const result = captureCommand('npm', ['view', 'pnpm', 'version']);
  if (result.code !== 0) return null;
  const version = result.stdout.trim();
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

function runInstallDependencies(reports: StepReport[], options: BootstrapOptions): void {
  logHeading('2/8 Dependencies');
  const startedAt = performance.now();
  if (options.skipDeps) {
    reportStep(reports, 'pnpm install', 'skipped', startedAt, '--skip-deps');
    return;
  }
  const nodeModulesPath = resolve(PROJECT_ROOT, 'node_modules');
  if (existsSync(nodeModulesPath) && statSync(nodeModulesPath).isDirectory()) {
    reportStep(
      reports,
      'pnpm install',
      'skipped',
      startedAt,
      'node_modules/ present (run pnpm install manually to refresh)',
    );
    return;
  }
  if (options.check) {
    reportStep(reports, 'pnpm install', 'skipped', startedAt, '--check mode (would install)');
    return;
  }
  const result = runCommand('pnpm', ['install', '--frozen-lockfile']);
  if (result.code !== 0) {
    reportStep(
      reports,
      'pnpm install',
      'failed',
      startedAt,
      'pnpm install --frozen-lockfile failed',
    );
    process.exit(1);
  }
  reportStep(reports, 'pnpm install', 'done', startedAt);
}

function runEnvScaffolding(reports: StepReport[], options: BootstrapOptions): void {
  logHeading('3/8 Environment files');
  scaffoldEnvDevelopmentIfMissing(reports, options);
  scaffoldEnvLocal(reports, options);
}

function scaffoldEnvDevelopmentIfMissing(reports: StepReport[], options: BootstrapOptions): void {
  const startedAt = performance.now();
  const envDevelopmentPath = resolve(PROJECT_ROOT, '.env.development');
  if (existsSync(envDevelopmentPath)) {
    reportStep(reports, '.env.development', 'skipped', startedAt, 'present');
    return;
  }
  if (options.check) {
    reportStep(
      reports,
      '.env.development',
      'warning',
      startedAt,
      '--check mode (would seed from .env.example)',
    );
    return;
  }
  const examplePath = resolve(PROJECT_ROOT, '.env.example');
  if (!existsSync(examplePath)) {
    reportStep(reports, '.env.development', 'failed', startedAt, '.env.example missing');
    process.exit(1);
  }
  let content = readFileSync(examplePath, 'utf8');
  content = injectGeneratedSecrets(content);
  writeFileSync(envDevelopmentPath, content);
  reportStep(
    reports,
    '.env.development',
    'done',
    startedAt,
    'seeded from .env.example with generated JWT keys + SECRETS_ENCRYPTION_KEY',
  );
}

function injectGeneratedSecrets(content: string): string {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const escapedPrivateKey = privateKey.replace(/\n/g, '\\n').trimEnd();
  const escapedPublicKey = publicKey.replace(/\n/g, '\\n').trimEnd();
  const secretsKey = randomBytes(32).toString('hex');

  let updated = content;
  updated = upsertEnvAssignment(updated, 'JWT_PRIVATE_KEY', `"${escapedPrivateKey}"`);
  updated = upsertEnvAssignment(updated, 'JWT_PUBLIC_KEY', `"${escapedPublicKey}"`);
  updated = upsertEnvAssignment(updated, 'SECRETS_ENCRYPTION_KEY', secretsKey);
  return updated;
}

function upsertEnvAssignment(content: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedKey}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (pattern.test(content)) return content.replace(pattern, line);
  return content.endsWith('\n') ? `${content}${line}\n` : `${content}\n${line}\n`;
}

const LOCAL_OVERRIDE_TEMPLATE = `# Machine-local override (gitignored). Loaded AFTER .env.<NODE_ENV>
# with override=true (non-production only). See \`.env.example\` for the
# canonical schema of variable names.

# Local Docker Compose stack (\`pnpm compose:up\`).
# Credentials match docker-compose.yml (POSTGRES_USER/PASSWORD/DB = core).
DATABASE_URL=postgresql://core:core@localhost:5432/core
DATABASE_MIGRATION_URL=postgresql://core:core@localhost:5432/core
REDIS_URL=redis://localhost:6379

# Local Postgres / Redis do not use TLS.
DATABASE_SSL_ENABLED=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
`;

function scaffoldEnvLocal(reports: StepReport[], options: BootstrapOptions): void {
  const startedAt = performance.now();
  const envLocalPath = resolve(PROJECT_ROOT, '.env.local');
  if (existsSync(envLocalPath) && !options.forceEnvLocal) {
    reportStep(
      reports,
      '.env.local',
      'skipped',
      startedAt,
      'present (use --force-env-local to rewrite)',
    );
    return;
  }
  if (options.check) {
    reportStep(
      reports,
      '.env.local',
      'warning',
      startedAt,
      '--check mode (would create localhost override)',
    );
    return;
  }
  writeFileSync(envLocalPath, LOCAL_OVERRIDE_TEMPLATE);
  reportStep(reports, '.env.local', 'done', startedAt, 'localhost override created');
}

function runDocker(reports: StepReport[], options: BootstrapOptions): void {
  logHeading('4/8 Docker Compose (postgres + redis)');
  if (options.skipDocker) {
    const startedAt = performance.now();
    reportStep(reports, 'docker compose', 'skipped', startedAt, '--skip-docker');
    return;
  }

  const postgresStartedAt = performance.now();
  const postgresState = inspectContainer(POSTGRES_CONTAINER);
  startOrSkipContainer(reports, 'postgres', postgresStartedAt, postgresState, options);

  const redisStartedAt = performance.now();
  const redisState = inspectContainer(REDIS_CONTAINER);
  startOrSkipContainer(reports, 'redis', redisStartedAt, redisState, options);

  if (options.withToxiproxy) {
    const toxiStartedAt = performance.now();
    if (options.check) {
      reportStep(reports, 'toxiproxy', 'skipped', toxiStartedAt, '--check mode');
    } else {
      const result = captureCommand('docker', [
        'compose',
        '--profile',
        'chaos',
        'up',
        '-d',
        'toxiproxy',
      ]);
      const status: StepStatus = result.code === 0 ? 'done' : 'warning';
      reportStep(
        reports,
        'toxiproxy',
        status,
        toxiStartedAt,
        result.code === 0 ? 'sidecar up' : 'failed to start',
      );
    }
  }

  const waitStartedAt = performance.now();
  if (options.check) {
    reportStep(reports, 'postgres ready', 'skipped', waitStartedAt, '--check mode');
    return;
  }
  const wait = captureCommand('bash', ['tooling/dev/wait-for-local-postgres.sh']);
  if (wait.code !== 0) {
    reportStep(reports, 'postgres ready', 'failed', waitStartedAt, 'wait script failed');
    process.exit(1);
  }
  reportStep(reports, 'postgres ready', 'done', waitStartedAt);
}

function startOrSkipContainer(
  reports: StepReport[],
  label: string,
  startedAt: number,
  state: ContainerState,
  options: BootstrapOptions,
): void {
  if (state.exists && state.running) {
    reportStep(
      reports,
      `${label} container`,
      'skipped',
      startedAt,
      `already running (health: ${state.health})`,
    );
    return;
  }
  if (options.check) {
    reportStep(reports, `${label} container`, 'warning', startedAt, '--check mode (would start)');
    return;
  }
  if (state.exists && !state.running) {
    const result = captureCommand('docker', ['compose', 'start', label]);
    const status: StepStatus = result.code === 0 ? 'done' : 'failed';
    reportStep(
      reports,
      `${label} container`,
      status,
      startedAt,
      status === 'done' ? 'started existing container' : 'docker compose start failed',
    );
    if (status === 'failed') process.exit(1);
    return;
  }
  const result = captureCommand('docker', ['compose', 'up', '-d', label]);
  const status: StepStatus = result.code === 0 ? 'done' : 'failed';
  reportStep(
    reports,
    `${label} container`,
    status,
    startedAt,
    status === 'done' ? 'created and started' : 'docker compose up failed',
  );
  if (status === 'failed') process.exit(1);
}

function runMigrations(reports: StepReport[], options: BootstrapOptions): void {
  logHeading('5/8 Migrations');
  const startedAt = performance.now();
  if (options.skipMigrate) {
    reportStep(reports, 'db:migrate', 'skipped', startedAt, '--skip-migrate');
    return;
  }
  if (options.check) {
    reportStep(reports, 'db:migrate', 'skipped', startedAt, '--check mode');
    return;
  }
  const result = runCommand('pnpm', ['db:migrate']);
  if (result.code !== 0) {
    reportStep(reports, 'db:migrate', 'failed', startedAt, 'pnpm db:migrate failed');
    process.exit(1);
  }
  reportStep(reports, 'db:migrate', 'done', startedAt);
}

function runSeed(reports: StepReport[], options: BootstrapOptions): void {
  logHeading('6/8 Seed');
  const startedAt = performance.now();
  if (options.seed === 'none') {
    reportStep(reports, 'seed', 'skipped', startedAt, 'pass --seed minimal | --seed full to seed');
    return;
  }
  if (options.check) {
    reportStep(
      reports,
      'seed',
      'skipped',
      startedAt,
      `--check mode (would run db:seed${options.seed === 'full' ? ':full' : ''})`,
    );
    return;
  }
  const script = options.seed === 'full' ? 'db:seed:full' : 'db:seed';
  const result = runCommand('pnpm', [script]);
  if (result.code !== 0) {
    reportStep(reports, script, 'failed', startedAt, 'seed script failed');
    process.exit(1);
  }
  reportStep(reports, script, 'done', startedAt);
}

function runOptionalWorker(reports: StepReport[], options: BootstrapOptions): ChildProcess | null {
  logHeading('7/8 Background worker');
  const startedAt = performance.now();
  if (!options.withWorker) {
    reportStep(reports, 'dev:worker', 'skipped', startedAt, 'pass --with-worker to spawn');
    return null;
  }
  if (options.check || options.noStart) {
    reportStep(
      reports,
      'dev:worker',
      'skipped',
      startedAt,
      options.check ? '--check mode' : '--no-start',
    );
    return null;
  }
  const worker = spawn('pnpm', ['dev:worker'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    detached: false,
  });
  reportStep(reports, 'dev:worker', 'done', startedAt, `pid=${worker.pid}`);
  return worker;
}

async function runDevServer(
  reports: StepReport[],
  options: BootstrapOptions,
  worker: ChildProcess | null,
): Promise<void> {
  logHeading('8/8 Dev server');
  const startedAt = performance.now();
  if (options.check) {
    reportStep(reports, 'dev', 'skipped', startedAt, '--check mode');
    return;
  }
  if (options.noStart) {
    reportStep(reports, 'dev', 'skipped', startedAt, '--no-start');
    return;
  }
  const inUse = await isPortInUse(DEFAULT_DEV_PORT);
  if (inUse) {
    reportStep(
      reports,
      'dev',
      'warning',
      startedAt,
      `port ${DEFAULT_DEV_PORT} already in use — dev may fail or attach unexpectedly`,
    );
  } else {
    reportStep(reports, 'dev', 'done', startedAt, `port ${DEFAULT_DEV_PORT} free`);
  }

  printReadyBanner();

  const dev = spawn('pnpm', ['dev'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    detached: false,
  });

  const cleanup = (): void => {
    if (worker && !worker.killed) worker.kill('SIGINT');
    if (!dev.killed) dev.kill('SIGINT');
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  await new Promise<void>((resolveExit) => {
    dev.on('exit', (code) => {
      if (worker && !worker.killed) worker.kill('SIGINT');
      process.exitCode = code ?? 0;
      resolveExit();
    });
  });
}

function printReadyBanner(): void {
  process.stdout.write(`\n${ANSI.bold}${ANSI.green}Ready — starting pnpm dev${ANSI.reset}\n`);
  logInfo(`API           ${ANSI.cyan}http://localhost:${DEFAULT_DEV_PORT}${ANSI.reset}`);
  logInfo(`Health        ${ANSI.cyan}http://localhost:${DEFAULT_DEV_PORT}/health${ANSI.reset}`);
  logInfo(
    `Scalar docs   ${ANSI.cyan}http://localhost:${DEFAULT_DEV_PORT}/api/reference${ANSI.reset} (if ENABLE_API_REFERENCE)`,
  );
  logInfo(
    `Queues        ${ANSI.cyan}http://localhost:${DEFAULT_DEV_PORT}/admin/queues${ANSI.reset} (if ENABLE_QUEUE_DASHBOARD)`,
  );
  process.stdout.write('\n');
}

function printSummary(reports: StepReport[]): void {
  logHeading('Summary');
  const counts: Record<StepStatus, number> = { done: 0, skipped: 0, warning: 0, failed: 0 };
  let totalMs = 0;
  for (const r of reports) {
    counts[r.status] += 1;
    totalMs += r.elapsedMs;
  }
  logInfo(
    `${ANSI.green}${counts.done} done${ANSI.reset}  ·  ${ANSI.gray}${counts.skipped} skipped${ANSI.reset}  ·  ${ANSI.yellow}${counts.warning} warning${ANSI.reset}  ·  ${ANSI.red}${counts.failed} failed${ANSI.reset}  ·  total ${Math.round(totalMs)}ms`,
  );
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  const options = parseArgs();
  const reports: StepReport[] = [];

  logBanner();
  if (options.check) logInfo(`${ANSI.yellow}--check mode: read-only, no mutations${ANSI.reset}`);

  ensureDevDirectoriesExist();
  runPreflight(reports);
  runInstallDependencies(reports, options);
  runEnvScaffolding(reports, options);
  runDocker(reports, options);
  runMigrations(reports, options);
  runSeed(reports, options);
  const worker = runOptionalWorker(reports, options);
  printSummary(reports);
  await runDevServer(reports, options, worker);
}

function ensureDevDirectoriesExist(): void {
  const dir = resolve(PROJECT_ROOT, 'tooling/dev');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

main().catch((error) => {
  process.stderr.write(
    `\n${ANSI.red}setup:local failed${ANSI.reset}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
