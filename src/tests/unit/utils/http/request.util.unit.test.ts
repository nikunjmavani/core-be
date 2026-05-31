import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import type { FastifyRequest } from 'fastify';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    id: 'req-123',
    auth: undefined,
    ...overrides,
  } as FastifyRequest;
}

describe('request.util', () => {
  describe('getRequestIdentifier', () => {
    it('returns request.id', () => {
      expect(getRequestIdentifier(mockRequest({ id: 'trace-abc' }))).toBe('trace-abc');
    });
  });

  describe('requireAuth', () => {
    it('returns auth context when userId is present', () => {
      const auth = { userId: 'user-1', role: 'user' as const };
      expect(requireAuth(mockRequest({ auth }))).toEqual(auth);
    });

    it('throws UnauthorizedError when auth is missing', () => {
      expect(() => requireAuth(mockRequest())).toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when userId is missing', () => {
      expect(() => requireAuth(mockRequest({ auth: { role: 'user' } as never }))).toThrow(
        UnauthorizedError,
      );
    });
  });
});
