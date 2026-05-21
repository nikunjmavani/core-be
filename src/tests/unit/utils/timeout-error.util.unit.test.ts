import { describe, expect, it } from 'vitest';
import {
  isFastifyRequestTimeoutError,
  isPostgresStatementTimeoutError,
} from '@/shared/utils/infrastructure/timeout-error.util.js';

describe('timeout-error.util', () => {
  it('detects Fastify request timeout errors', () => {
    expect(isFastifyRequestTimeoutError({ code: 'FST_ERR_REQ_TIMEOUT' })).toBe(true);
    expect(isFastifyRequestTimeoutError(new Error('other'))).toBe(false);
  });

  it('detects Postgres statement timeout by SQLSTATE and message', () => {
    expect(isPostgresStatementTimeoutError({ code: '57014' })).toBe(true);
    expect(
      isPostgresStatementTimeoutError(new Error('canceling statement due to statement timeout')),
    ).toBe(true);
    expect(isPostgresStatementTimeoutError(new Error('connection refused'))).toBe(false);
  });
});
