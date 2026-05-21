import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CATALOG_CACHE_MAX_AGE_SECONDS,
  CATALOG_CACHE_STALE_WHILE_REVALIDATE_SECONDS,
} from '@/shared/constants/index.js';

/** Cache-Control for rarely changing public catalogs (plans, permissions). */
export const CATALOG_CACHE_CONTROL = `public, max-age=${CATALOG_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${CATALOG_CACHE_STALE_WHILE_REVALIDATE_SECONDS}`;

/**
 * Catalog list payloads use the Paddle envelope; ETag must ignore per-request meta
 * (e.g. meta.request_id) so repeat fetches can return 304.
 */
export function catalogPayloadForEtag(envelope: unknown): unknown {
  if (typeof envelope === 'object' && envelope !== null && 'data' in envelope) {
    return (envelope as { data: unknown }).data;
  }
  return envelope;
}

/**
 * Weak ETag from a stable JSON serialization of the response payload.
 */
export function computeWeakEtag(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  const digest = createHash('sha256').update(serialized).digest('base64url');
  return `W/"${digest}"`;
}

/**
 * Weak ETag for catalog list responses (hashes catalog data only).
 */
export function computeCatalogWeakEtag(envelope: unknown): string {
  return computeWeakEtag(catalogPayloadForEtag(envelope));
}

/**
 * Returns true when the If-None-Match header matches the current ETag.
 */
export function ifNoneMatchSatisfies(
  ifNoneMatchHeader: string | string[] | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatchHeader) {
    return false;
  }
  const headerValues = Array.isArray(ifNoneMatchHeader) ? ifNoneMatchHeader : [ifNoneMatchHeader];
  for (const headerValue of headerValues) {
    for (const candidate of headerValue.split(',')) {
      const normalized = candidate.trim();
      if (normalized === '*' || normalized === etag) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Sets ETag and Cache-Control on a catalog GET response.
 * Returns true when If-None-Match matches and the handler should send 304 with no body.
 */
export function applyCatalogCacheHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): boolean {
  const etag = computeCatalogWeakEtag(payload);
  reply.header('ETag', etag);
  reply.header('Cache-Control', CATALOG_CACHE_CONTROL);

  if (ifNoneMatchSatisfies(request.headers['if-none-match'], etag)) {
    reply.status(304).send();
    return true;
  }
  return false;
}
