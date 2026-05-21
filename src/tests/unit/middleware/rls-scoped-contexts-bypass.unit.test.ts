import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTransaction = vi.fn(async (callback: (transaction: unknown) => Promise<void>) => {
  await callback({ execute: mockExecute });
});

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    LOG_LEVEL: 'silent',
    DB_HTTP_STATEMENT_TIMEOUT_MS: 5_000,
    DB_RLS_SCOPED_CONTEXTS: true,
  },
}));

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    transaction: (callback: (transaction: unknown) => Promise<void>) => mockTransaction(callback),
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

describe('DB_RLS_SCOPED_CONTEXTS bypass for both pinning middlewares (production hardening item 2)', () => {
  it('organization-rls-transaction middleware never opens a transaction when flag is on', async () => {
    const { default: organizationRlsMiddleware } =
      await import('@/shared/middlewares/organization-rls-transaction.middleware.js');
    const application = Fastify({ logger: false });
    application.addHook('onRequest', (request, _reply, done) => {
      (request as { organizationId?: string }).organizationId = 'org_public_id_chaos_bypass';
      done();
    });
    await application.register(organizationRlsMiddleware);
    application.get('/probe', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await application.close();
  });

  it('request-statement-timeout middleware never opens a transaction when flag is on', async () => {
    mockTransaction.mockClear();
    const { default: requestStatementTimeoutMiddleware } =
      await import('@/shared/middlewares/request-statement-timeout.middleware.js');
    const application = Fastify({ logger: false });
    await application.register(requestStatementTimeoutMiddleware);
    application.get('/probe', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await application.close();
  });
});
