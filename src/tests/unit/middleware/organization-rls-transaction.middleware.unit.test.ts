import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import organizationRlsTransactionMiddleware, {
  settleAndAwaitOrganizationRlsTransaction,
  type OrganizationRlsTransactionSettlementOutcome,
} from '@/shared/middlewares/organization-rls-transaction.middleware.js';
import requestLifecycleMiddleware from '@/shared/middlewares/request-lifecycle.middleware.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

/**
 * The request lifecycle coordinator owns settle in production wiring — register it
 * alongside the RLS middleware in every test app so commits/rollbacks actually fire.
 */
async function registerLifecyclePlugins(application: FastifyInstance): Promise<void> {
  await application.register(requestLifecycleMiddleware);
  await application.register(organizationRlsTransactionMiddleware);
}

async function registerOrganizationRlsWithSettlementCapture(
  application: FastifyInstance,
  capture: { outcome?: OrganizationRlsTransactionSettlementOutcome },
): Promise<void> {
  await application.register(organizationRlsTransactionMiddleware);
  application.addHook('onResponse', async (request, reply) => {
    capture.outcome = await settleAndAwaitOrganizationRlsTransaction(request, reply);
  });
}

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTransaction = vi.fn();

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    LOG_LEVEL: 'silent',
    DATABASE_HTTP_STATEMENT_TIMEOUT_MS: 5_000,
    DATABASE_RLS_SCOPED_CONTEXTS: false,
  },
}));

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    transaction: (callback: (transaction: { execute: typeof mockExecute }) => Promise<void>) =>
      mockTransaction(callback),
  },
}));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  organizationRequestDatabaseStorage: {
    run: (_store: unknown, callback: () => void) => {
      callback();
    },
  },
}));

// The lifecycle coordinator pulls in idempotency (→ redis) and the event bus. Stub them
// out so this test stays focused on RLS commit/rollback behavior.
vi.mock('@/shared/middlewares/idempotency.middleware.js', () => ({
  default: async () => undefined,
  idempotencyOnResponse: vi.fn(async () => undefined),
}));

vi.mock('@/core/events/event-bus.js', () => ({
  eventBus: { flushOnCommit: vi.fn(async () => undefined) },
  enterOnCommitScope: vi.fn(),
}));

async function createOrganizationRlsApp() {
  const application = Fastify({ logger: false });
  await registerLifecyclePlugins(application);
  application.get('/probe', async (request) => ({
    organizationId: (request as { organizationId?: string | null }).organizationId ?? null,
  }));
  await application.ready();
  return application;
}

describe('organization-rls-transaction.middleware', () => {
  let application: Awaited<ReturnType<typeof createOrganizationRlsApp>>;

  afterEach(async () => {
    vi.clearAllMocks();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async (callback) => {
      await callback({ execute: mockExecute });
    });
    if (application) {
      await application.close();
    }
  });

  it('continues without transaction when organization id is empty string', async () => {
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = '';
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await scopedApplication.close();
  });

  it('continues without transaction when organization id is null', async () => {
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string | null }).organizationId = null;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await scopedApplication.close();
  });

  it('continues without transaction when organization id is absent', async () => {
    application = await createOrganizationRlsApp();
    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(response.json().organizationId).toBeNull();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('starts transaction scope when organization id is set on request', async () => {
    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async (request) => ({
      organizationId: (request as { organizationId?: string }).organizationId,
    }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(response.json().organizationId).toBe(organizationPublicId);
    expect(mockExecute).toHaveBeenCalled();
    await scopedApplication.close();
  });

  it('sets LOCAL statement_timeout on the organization transaction connection', async () => {
    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    await scopedApplication.inject({ method: 'GET', url: '/probe' });

    const executeCalls = mockExecute.mock.calls.map(
      (call) => call[0]?.queryChunks?.[0]?.value ?? String(call[0]),
    );
    expect(executeCalls.some((query) => String(query).includes('statement_timeout'))).toBe(true);
    await scopedApplication.close();
  });

  it('commits transaction for successful 204 responses', async () => {
    let transactionRejected = false;
    mockTransaction.mockImplementationOnce(async (callback) => {
      try {
        await callback({ execute: mockExecute });
      } catch {
        transactionRejected = true;
      }
    });

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.delete('/probe', async (_request, reply) => {
      reply.code(204).send();
    });
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'DELETE', url: '/probe' });
    expect(response.statusCode).toBe(204);
    expect(transactionRejected).toBe(false);
    await scopedApplication.close();
  });

  it('rolls back transaction when response status is 4xx', async () => {
    let transactionRejected = false;
    mockTransaction.mockImplementationOnce(async (callback) => {
      try {
        await callback({ execute: mockExecute });
      } catch {
        transactionRejected = true;
      }
    });

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/fail', async (_request, reply) => {
      reply.status(404).send({ error: 'not_found' });
    });
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/fail' });
    expect(response.statusCode).toBe(404);
    expect(transactionRejected).toBe(true);
    await scopedApplication.close();
  });

  it('rolls back transaction when response status is 5xx', async () => {
    let transactionRejected = false;
    mockTransaction.mockImplementationOnce(async (callback) => {
      try {
        await callback({ execute: mockExecute });
      } catch {
        transactionRejected = true;
      }
    });

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/server-error', async (_request, reply) => {
      reply.status(500).send({ error: 'internal_error' });
    });
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/server-error' });
    expect(response.statusCode).toBe(500);
    expect(transactionRejected).toBe(true);
    await scopedApplication.close();
  });

  it('fails onRequest when the database transaction rejects before the hook completes', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('transaction start failed'));

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(500);
    await scopedApplication.close();
  });

  it('continues without transaction when organization id property is undefined', async () => {
    application = await createOrganizationRlsApp();
    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('ignores duplicate safeDone calls from request database storage', async () => {
    const { organizationRequestDatabaseStorage } = await import(
      '@/infrastructure/database/contexts/request-database.context.js'
    );
    const runSpy = vi
      .spyOn(organizationRequestDatabaseStorage, 'run')
      .mockImplementation((_store, callback) => {
        callback();
        callback();
      });

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    runSpy.mockRestore();
    await scopedApplication.close();
  });

  it('fails onRequest when transaction rejects with a non-Error value', async () => {
    mockTransaction.mockRejectedValueOnce('transaction rejected');

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(500);
    await scopedApplication.close();
  });

  it('commits when reply statusCode is undefined and treats it as success', async () => {
    let transactionRejected = false;
    mockTransaction.mockImplementationOnce(async (callback) => {
      try {
        await callback({ execute: mockExecute });
      } catch {
        transactionRejected = true;
      }
    });

    const organizationPublicId = generatePublicId();
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/no-status', async (_request, reply) => {
      Object.defineProperty(reply, 'statusCode', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      return { ok: true };
    });
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/no-status' });
    expect(response.statusCode).toBe(200);
    expect(transactionRejected).toBe(false);
    await scopedApplication.close();
  });

  it('returns no_transaction when no organization id was set', async () => {
    const capture: { outcome?: OrganizationRlsTransactionSettlementOutcome } = {};
    const scopedApplication = Fastify({ logger: false });
    await registerOrganizationRlsWithSettlementCapture(scopedApplication, capture);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(capture.outcome).toBe('no_transaction');
    await scopedApplication.close();
  });

  it('returns committed after a successful org-scoped response', async () => {
    const organizationPublicId = generatePublicId();
    const capture: { outcome?: OrganizationRlsTransactionSettlementOutcome } = {};
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerOrganizationRlsWithSettlementCapture(scopedApplication, capture);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(capture.outcome).toBe('committed');
    await scopedApplication.close();
  });

  it('returns rolled_back when the HTTP response is 4xx', async () => {
    const organizationPublicId = generatePublicId();
    const capture: { outcome?: OrganizationRlsTransactionSettlementOutcome } = {};
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerOrganizationRlsWithSettlementCapture(scopedApplication, capture);
    scopedApplication.get('/fail', async (_request, reply) => {
      reply.status(404).send({ error: 'not_found' });
    });
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/fail' });
    expect(response.statusCode).toBe(404);
    expect(capture.outcome).toBe('rolled_back');
    await scopedApplication.close();
  });

  it('returns settle_failed when commit was intended but the outer transaction rejects', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      try {
        await callback({ execute: mockExecute });
      } catch {
        /* inner rejection from HTTP 2xx path should not happen here */
      }
      throw new Error('commit failed after resolve');
    });

    const organizationPublicId = generatePublicId();
    const capture: { outcome?: OrganizationRlsTransactionSettlementOutcome } = {};
    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerOrganizationRlsWithSettlementCapture(scopedApplication, capture);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(capture.outcome).toBe('settle_failed');
    await scopedApplication.close();
  });

  it('logs transaction failures that occur after onRequest has completed', async () => {
    const organizationPublicId = generatePublicId();
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const warnSpy = vi.spyOn(logger, 'warn');

    mockTransaction.mockImplementationOnce(async (callback) => {
      await callback({ execute: mockExecute });
      throw new Error('late transaction failure');
    });

    const scopedApplication = Fastify({ logger: false });
    scopedApplication.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = organizationPublicId;
      done();
    });
    await registerLifecyclePlugins(scopedApplication);
    scopedApplication.get('/probe', async () => ({ ok: true }));
    await scopedApplication.ready();

    const response = await scopedApplication.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(warnSpy).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'organization.rls.transaction.failure_after_on_request',
    );
    warnSpy.mockRestore();
    await scopedApplication.close();
  });
});
