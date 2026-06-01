import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import organizationRlsTransactionMiddleware, {
  settleAndAwaitOrganizationRlsTransaction,
} from '@/shared/middlewares/tenant/organization-rls-transaction.middleware.js';

const mockTransaction = vi.fn();

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    transaction: (callback: (transaction: unknown) => Promise<void>) => mockTransaction(callback),
  },
}));

async function createApplication(): Promise<FastifyInstance> {
  const application = Fastify({ logger: false });
  application.addHook('onRequest', (request, _reply, done) => {
    (request as { organizationId?: string }).organizationId = 'org_public_id_scoped_only';
    done();
  });
  await application.register(organizationRlsTransactionMiddleware);
  application.get('/probe', async () => ({ ok: true }));
  await application.ready();
  return application;
}

describe('organization-rls-transaction.middleware (scoped contexts only)', () => {
  afterEach(() => {
    mockTransaction.mockClear();
  });

  it('never opens a request-pinned transaction', async () => {
    const application = await createApplication();
    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
    await application.close();
  });

  it('settlement always reports no_transaction', async () => {
    const outcome = await settleAndAwaitOrganizationRlsTransaction(
      {} as Parameters<typeof settleAndAwaitOrganizationRlsTransaction>[0],
      { statusCode: 200 } as Parameters<typeof settleAndAwaitOrganizationRlsTransaction>[1],
    );
    expect(outcome).toBe('no_transaction');
  });
});
