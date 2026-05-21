import type { FastifyRequest } from 'fastify';

/**
 * Resolves a user-facing message when `request.t` may be absent (e.g. early middleware).
 */
export function translateRequestMessage(
  request: Pick<FastifyRequest, 't'>,
  messageKey: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  const translate = request.t;
  if (translate) {
    return translate(messageKey, params ?? {});
  }
  return fallback;
}
