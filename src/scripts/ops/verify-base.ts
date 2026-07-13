/**
 * End-to-end verify gate: migrate → minimal seed → full seed → API smoke → validate.
 *
 * Prerequisites:
 * - `docker compose up -d` (Postgres + Redis for migrate, seed, and server)
 * - Optional: `pnpm compose:wait` after compose up so Postgres is ready before migrate.
 * - Set `TEST_PASSWORD` in `.env` to match smoke defaults (e.g. DemoPassword123!),
 *   otherwise full seed may generate a random demo password and login will fail.
 *
 * Usage: pnpm verify:base
 * Verbose server logs: VERIFY_BASE_VERBOSE=1 pnpm verify:base
 */
import '@/shared/config/load-env-files.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const BASE_URL_FOR_HEALTH = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const HEALTH_URL = `${BASE_URL_FOR_HEALTH}/readyz`;
const POLL_INTERVAL_MILLISECONDS = 500;
const HEALTH_CHECK_TIMEOUT_MILLISECONDS = 1000;
const READY_WAIT_TIMEOUT_MILLISECONDS = 60_000;
const TEARDOWN_GRACE_MILLISECONDS = 5000;

const spawnedChildProcesses: ChildProcess[] = [];

let didRegisterSignalHandlers = false;

function isVerboseDevLogs(): boolean {
  return process.env.VERIFY_BASE_VERBOSE === '1';
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function registerSignalHandlersForTeardown(): void {
  if (didRegisterSignalHandlers) {
    return;
  }
  didRegisterSignalHandlers = true;
  const teardownSynchronously = (): void => {
    for (const child of spawnedChildProcesses) {
      if (!child.killed && child.pid !== undefined) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    }
  };
  process.on('SIGINT', () => {
    teardownSynchronously();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    teardownSynchronously();
    process.exit(143);
  });
}

function runPnpmStep(stepName: string, pnpmArguments: string[]): Promise<void> {
  const startedAt = performance.now();
  logger.info({ stepName, pnpmArguments }, 'verify.base: step start');
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', pnpmArguments, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.once('error', (error) => {
      reject(error);
    });
    child.once('close', (exitCode) => {
      if (exitCode === 0) {
        logger.info(
          { stepName, durationMs: Math.round(performance.now() - startedAt) },
          'verify.base: step done',
        );
        resolve();
      } else {
        reject(new Error(`${stepName} exited with code ${exitCode ?? 'unknown'}`));
      }
    });
  });
}

async function fetchHealthReadyOk(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, HEALTH_CHECK_TIMEOUT_MILLISECONDS);
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal });
    return response.ok && response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForServerReady(): Promise<void> {
  const deadline = Date.now() + READY_WAIT_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    if (await fetchHealthReadyOk()) {
      logger.info('verify.base: server ready');
      return;
    }
    await sleep(POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error(
    `Server did not become ready within ${READY_WAIT_TIMEOUT_MILLISECONDS / 1000}s (${HEALTH_URL})`,
  );
}

async function teardownSpawnedProcesses(): Promise<void> {
  if (spawnedChildProcesses.length === 0) {
    return;
  }
  logger.info('verify.base: stopping spawned dev processes');
  for (const child of spawnedChildProcesses) {
    if (!child.killed && child.pid !== undefined) {
      child.kill('SIGTERM');
    }
  }
  await sleep(TEARDOWN_GRACE_MILLISECONDS);
  for (const child of spawnedChildProcesses) {
    if (!child.killed && child.pid !== undefined) {
      child.kill('SIGKILL');
    }
  }
  spawnedChildProcesses.length = 0;
}

async function ensureServerRunning(): Promise<void> {
  if (await fetchHealthReadyOk()) {
    logger.info('verify.base: using existing server (health ready)');
    return;
  }

  registerSignalHandlersForTeardown();

  const stdioMode = isVerboseDevLogs() ? 'inherit' : 'ignore';

  logger.info('verify.base: starting pnpm dev and pnpm dev:worker in background');

  const developmentServer = spawn('pnpm', ['dev'], {
    cwd: process.cwd(),
    stdio: stdioMode,
    shell: process.platform === 'win32',
    env: process.env,
  });
  const workerProcess = spawn('pnpm', ['dev:worker'], {
    cwd: process.cwd(),
    stdio: stdioMode,
    shell: process.platform === 'win32',
    env: process.env,
  });

  spawnedChildProcesses.push(developmentServer, workerProcess);

  for (const child of [developmentServer, workerProcess]) {
    child.once('error', (error) => {
      logger.error({ error }, 'verify.base: child process error');
    });
  }

  await waitForServerReady();
}

async function main(): Promise<void> {
  registerSignalHandlersForTeardown();

  logger.info('verify.base: starting gate');
  const gateStartedAt = performance.now();

  try {
    await runPnpmStep('db:migrate', ['db:migrate']);
    await runPnpmStep('db:seed', ['db:seed']);
    await runPnpmStep('db:seed:full', ['db:seed:full']);
    await ensureServerRunning();
    await runPnpmStep('test:api-smoke', ['test:api-smoke']);
  } finally {
    await teardownSpawnedProcesses();
  }

  await runPnpmStep('validate', ['validate']);

  logger.info(
    { durationMs: Math.round(performance.now() - gateStartedAt) },
    'verify.base: gate completed successfully',
  );
}

main().catch((error) => {
  logger.error({ error }, 'verify.base: gate failed');
  process.exit(1);
});
