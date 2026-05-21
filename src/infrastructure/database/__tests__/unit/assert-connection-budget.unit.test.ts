import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const getEnvMock = vi.fn();
const originalKubernetesServiceHost = process.env.KUBERNETES_SERVICE_HOST;

vi.mock('@/infrastructure/database/connection.js', () => ({
  sql: (...arguments_: unknown[]) => sqlMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: new Proxy(
    {},
    {
      get(_target, property) {
        return getEnvMock()[property as string];
      },
    },
  ),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('assertPostgresConnectionBudget', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    getEnvMock.mockReset();
    vi.resetModules();
    delete process.env.KUBERNETES_SERVICE_HOST;
  });

  afterEach(() => {
    if (originalKubernetesServiceHost === undefined) {
      delete process.env.KUBERNETES_SERVICE_HOST;
    } else {
      process.env.KUBERNETES_SERVICE_HOST = originalKubernetesServiceHost;
    }
  });

  it('throws when deployment process count exceeds allowed connections', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 50,
      DEPLOYMENT_TOTAL_REPLICA_COUNT: 5,
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).rejects.toThrow(/connection budget exceeded/i);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('passes when deployment process count fits the budget', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      DEPLOYMENT_TOTAL_REPLICA_COUNT: 2,
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).resolves.toBeUndefined();
  });

  it('requires deployment process count in production', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      NODE_ENV: 'production',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).rejects.toThrow(
      /DEPLOYMENT_TOTAL_REPLICA_COUNT/i,
    );
  });

  it('asserts worker concurrency against DATABASE_POOL_MAX when requested', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      DEPLOYMENT_TOTAL_REPLICA_COUNT: 1,
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: 10,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget({ assertWorkerConcurrency: true })).rejects.toThrow(
      /WORKER_CONCURRENCY/i,
    );
  });

  it('passes when split API and worker counts fit the budget', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      DEPLOYMENT_API_REPLICA_COUNT: 1,
      DEPLOYMENT_WORKER_REPLICA_COUNT: 1,
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).resolves.toBeUndefined();
  });

  it('throws when split API and worker counts exceed the budget', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 50,
      DEPLOYMENT_API_REPLICA_COUNT: 4,
      DEPLOYMENT_WORKER_REPLICA_COUNT: 1,
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).rejects.toThrow(/connection budget exceeded/i);
  });

  it('requires both split counts when using either one', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      DEPLOYMENT_API_REPLICA_COUNT: 2,
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).rejects.toThrow(/must both be set/i);
  });

  it('asserts local docker default of one API and one worker when counts are unset', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 15,
      NODE_ENV: 'development',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).rejects.toThrow(/connection budget exceeded/i);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('requires deployment counts on hosted Railway deployments (RAILWAY_GIT_COMMIT_SHA set, NODE_ENV=development)', async () => {
    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      NODE_ENV: 'development',
      WORKER_CONCURRENCY: 4,
      RAILWAY_GIT_COMMIT_SHA: 'deadbeef',
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');

    await expect(assertPostgresConnectionBudget()).rejects.toThrow(
      /DEPLOYMENT_TOTAL_REPLICA_COUNT/i,
    );
  });

  it('requires deployment counts on hosted Kubernetes deployments (KUBERNETES_SERVICE_HOST set)', async () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';

    getEnvMock.mockReturnValue({
      DATABASE_POOL_MAX: 10,
      POSTGRES_RESERVED_CONNECTIONS: 10,
      POSTGRES_MAX_CONNECTIONS: 100,
      NODE_ENV: 'staging',
      WORKER_CONCURRENCY: 4,
    });

    const { assertPostgresConnectionBudget } =
      await import('@/infrastructure/database/assert-connection-budget.js');
    await expect(assertPostgresConnectionBudget()).rejects.toThrow(
      /DEPLOYMENT_TOTAL_REPLICA_COUNT/i,
    );
  });
});
