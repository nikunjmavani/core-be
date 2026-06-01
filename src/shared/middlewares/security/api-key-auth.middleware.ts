import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@/shared/errors/index.js';
import type { AuthContext } from '@/shared/types/index.js';

const API_KEY_PREFIX = 'ak_';

/**
 * Extracts an API key from `Authorization: ApiKey ...`, `Authorization:
 * Bearer ak_...`, or `X-Api-Key`, in that order. Returns `null` when no
 * recognised header is present; never throws.
 */
export function extractApiKeyFromRequest(request: FastifyRequest): string | null {
  const authorizationHeader = request.headers.authorization;
  if (authorizationHeader) {
    const apiKeyMatch = /^ApiKey\s+(\S.*)$/i.exec(authorizationHeader);
    const apiKeyCandidate = apiKeyMatch?.[1]?.trim();
    if (apiKeyCandidate?.startsWith(API_KEY_PREFIX)) return apiKeyCandidate;

    const bearerMatch = /^Bearer\s+(\S.*)$/i.exec(authorizationHeader);
    const bearerCandidate = bearerMatch?.[1]?.trim();
    if (bearerCandidate?.startsWith(API_KEY_PREFIX)) return bearerCandidate;
  }

  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.startsWith(API_KEY_PREFIX)) {
    return apiKeyHeader.trim();
  }

  return null;
}

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

function hashesMatch(storedHash: string, candidateHash: string): boolean {
  const storedBuffer = Buffer.from(storedHash, 'hex');
  const candidateBuffer = Buffer.from(candidateHash, 'hex');
  if (storedBuffer.length !== candidateBuffer.length) return false;
  return timingSafeEqual(storedBuffer, candidateBuffer);
}

/**
 * Authenticates the request with an organization API key when present.
 * Returns true when API key auth succeeded; false when no API key was sent.
 * Throws when a key was sent but is invalid.
 */
export async function applyApiKeyAuthentication(request: FastifyRequest): Promise<boolean> {
  const rawKey = extractApiKeyFromRequest(request);
  if (!rawKey) {
    return false;
  }

  if (!request.server.tenancyDomain?.organizationApiKeyService) {
    throw new UnauthorizedError('errors:validation.invalidToken');
  }

  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);
  const match = await request.server.tenancyDomain.organizationApiKeyService.authenticate(
    keyPrefix,
    keyHash,
    hashesMatch,
  );

  if (!match) {
    throw new UnauthorizedError('errors:validation.invalidToken');
  }

  const authContext: AuthContext = {
    kind: 'apiKey',
    apiKeyPublicId: match.public_id,
    apiKeyScopes: match.scopes,
    organizationPublicId: match.organization_public_id,
  };

  request.auth = authContext;
  request.organizationId = match.organization_public_id;
  return true;
}
