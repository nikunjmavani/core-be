import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@/shared/errors/index.js';
import type { AuthContext } from '@/shared/types/index.js';

export function getRequestIdentifier(request: FastifyRequest): string {
  return request.id;
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth?.userId) throw new UnauthorizedError();
  return request.auth;
}
