import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import requestStatementTimeoutMiddleware from '@/shared/middlewares/core/request-statement-timeout.middleware.js';

const mockTransaction = vi.fn();

vi.mock('@/infrastructure/database/connection.js', () => ({
  database: {
    transaction: (callback: (transaction: unknown) => Promise<void>) => mockTransaction(callback),
  },
}));

describe('request-statement-timeout.middleware (connection-level timeout only)', () => {
  afterEach(() => {
    mockTransaction.mockClear();
  });

  it('never opens a request-pinned transaction', async () => {
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
