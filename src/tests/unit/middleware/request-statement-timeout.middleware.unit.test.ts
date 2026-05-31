import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import requestStatementTimeoutMiddleware from '@/shared/middlewares/core/request-statement-timeout.middleware.js';

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTransaction = vi.fn();

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
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
  getOrganizationRequestDatabaseSession: vi.fn(() => undefined),
  organizationRequestDatabaseStorage: {
    run: (_store: unknown, callback: () => void) => {
      callback();
    },
  },
}));

describe('request-statement-timeout.middleware', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async (callback) => {
      await callback({ execute: mockExecute });
    });
  });

  it('skips health routes without opening a transaction', async () => {
    const application = Fastify({ logger: false });
    await application.register(requestStatementTimeoutMiddleware);
    application.get('/livez', async () => ({ status: 'ok' }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/livez' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await application.close();
  });

  it('sets LOCAL statement_timeout for routes without organization context', async () => {
    const application = Fastify({ logger: false });
    await application.register(requestStatementTimeoutMiddleware);
    application.get('/probe', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
    const executeCalls = mockExecute.mock.calls.map(
      (call) => call[0]?.queryChunks?.[0]?.value ?? String(call[0]),
    );
    expect(executeCalls.some((query) => String(query).includes('statement_timeout'))).toBe(true);
    await application.close();
  });

  it('skips when organization id is set on the request', async () => {
    const application = Fastify({ logger: false });
    application.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = 'org_public_id';
      done();
    });
    await application.register(requestStatementTimeoutMiddleware);
    application.get('/probe', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await application.close();
  });
});
