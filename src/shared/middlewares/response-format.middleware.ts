import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
type RouteConfig = { raw_response?: boolean };

/** Paddle-style envelope: { data, meta: { request_id, ... } } */
export function isPaddleEnvelope(
  payload: unknown,
): payload is { data: unknown; meta: { request_id: string } } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'data' in payload &&
    'meta' in payload &&
    typeof (payload as { meta?: unknown }).meta === 'object' &&
    (payload as { meta: { request_id?: unknown } }).meta !== null &&
    typeof (payload as { meta: { request_id: unknown } }).meta.request_id === 'string'
  );
}

/**
 * Wraps successful JSON payloads in the Paddle-style `{ data, meta: { request_id } }`
 * envelope used by the public API. Skipped for error responses (≥400), non-JSON content
 * types, already-wrapped payloads, and routes that opt out via `raw_response` route config.
 */
export function formatResponsePayload(
  payload: unknown,
  context: {
    rawResponse?: boolean;
    statusCode: number;
    contentType: unknown;
    requestId: string;
  },
): unknown {
  if (context.rawResponse) return payload;
  if (context.statusCode >= 400) return payload;

  if (isPaddleEnvelope(payload)) return payload;

  const isJson =
    typeof context.contentType === 'string'
      ? context.contentType.includes('application/json')
      : false;
  if (!isJson) return payload;

  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (isPaddleEnvelope(parsed)) return payload;
      return JSON.stringify({ data: parsed, meta: { request_id: context.requestId } });
    } catch {
      return payload;
    }
  }

  return { data: payload, meta: { request_id: context.requestId } };
}

const responseFormatMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (request, reply, payload) => {
    const config = (reply.routeOptions?.config ?? {}) as RouteConfig;
    return formatResponsePayload(payload, {
      statusCode: reply.statusCode,
      contentType: reply.getHeader('content-type'),
      requestId: request.id,
      ...(config.raw_response !== undefined ? { rawResponse: config.raw_response } : {}),
    });
  });
};

export default fp(responseFormatMiddleware, { name: 'response-format-middleware' });
