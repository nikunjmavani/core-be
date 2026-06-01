import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';
import {
  getActingUserPublicId,
  getAuthenticatedActorId,
  getRequestIdentifier,
  isApiKeyPrincipal,
  isUserPrincipal,
  requireAuth,
  requirePrincipal,
} from '@/shared/utils/http/request.util.js';
import type { ApiKeyAuthContext, UserAuthContext } from '@/shared/types/index.js';
import type { FastifyRequest } from 'fastify';

const userPrincipal: UserAuthContext = { kind: 'user', userId: 'user-1', role: 'user' };
const apiKeyPrincipal: ApiKeyAuthContext = {
  kind: 'apiKey',
  apiKeyPublicId: 'key-1',
  apiKeyScopes: ['membership:read'],
  organizationPublicId: 'org-1',
};

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
      const auth = { kind: 'user' as const, userId: 'user-1', role: 'user' as const };
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

    it('throws UnauthorizedError for an API-key principal (user-only route)', () => {
      expect(() => requireAuth(mockRequest({ auth: apiKeyPrincipal }))).toThrow(UnauthorizedError);
    });
  });

  describe('requirePrincipal', () => {
    it('returns a user principal', () => {
      expect(requirePrincipal(mockRequest({ auth: userPrincipal }))).toEqual(userPrincipal);
    });

    it('returns an API-key principal', () => {
      expect(requirePrincipal(mockRequest({ auth: apiKeyPrincipal }))).toEqual(apiKeyPrincipal);
    });

    it('throws UnauthorizedError when unauthenticated', () => {
      expect(() => requirePrincipal(mockRequest())).toThrow(UnauthorizedError);
    });
  });

  describe('principal helpers', () => {
    it('narrows principal kinds', () => {
      expect(isUserPrincipal(userPrincipal)).toBe(true);
      expect(isUserPrincipal(apiKeyPrincipal)).toBe(false);
      expect(isApiKeyPrincipal(apiKeyPrincipal)).toBe(true);
      expect(isApiKeyPrincipal(userPrincipal)).toBe(false);
    });

    it('getActingUserPublicId returns the user id for users and undefined for API keys', () => {
      expect(getActingUserPublicId(userPrincipal)).toBe('user-1');
      expect(getActingUserPublicId(apiKeyPrincipal)).toBeUndefined();
    });

    it('getAuthenticatedActorId returns a non-empty actor id for both principal kinds', () => {
      expect(getAuthenticatedActorId(userPrincipal)).toBe('user-1');
      expect(getAuthenticatedActorId(apiKeyPrincipal)).toBe('key-1');
    });
  });
});
