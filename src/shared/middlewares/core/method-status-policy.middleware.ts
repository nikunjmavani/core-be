import type { FastifyInstance } from 'fastify';

/**
 * Routes exempt from the uniform method→status policy because their status
 * semantics are defined by an external protocol, not by this API:
 * Stripe webhooks must acknowledge with 200, and the MCP streamable-HTTP
 * transport owns its response codes.
 */
export const METHOD_STATUS_POLICY_EXEMPT_PREFIXES = [
  '/api/v1/billing/webhook',
  '/api/v1/mcp',
] as const;

/**
 * Uniform method→success-status policy, enforced centrally:
 *
 * | Method  | Success status |
 * | ------- | -------------- |
 * | GET     | 200            |
 * | POST    | 201            |
 * | PUT     | 200            |
 * | PATCH   | 200            |
 * | DELETE  | 204            |
 *
 * Exceptions: webhook ingestion + MCP transport (see
 * {@link METHOD_STATUS_POLICY_EXEMPT_PREFIXES}) stay 200.
 *
 * @remarks
 * - **Algorithm:** an `onSend` hook normalizes any 200/202/204 a POST handler
 *   produced to 201 (other methods/statuses pass through untouched), so every
 *   current and future POST conforms without per-handler boilerplate.
 * - **Failure modes:** none — error statuses (>= 300) are never rewritten.
 * - **Side effects:** response status only; bodies are untouched (a 204-bodied
 *   POST becomes a 201 with empty body).
 * - **Notes:** declared statuses live in route-success-statuses.json and are
 *   runtime-verified by the observed-status gate; this hook is the enforcement
 *   point that keeps controllers honest.
 */
export function registerMethodStatusPolicy(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'POST') {
      return payload;
    }
    const routeUrl = request.routeOptions.url ?? '';
    if (METHOD_STATUS_POLICY_EXEMPT_PREFIXES.some((prefix) => routeUrl.startsWith(prefix))) {
      return payload;
    }
    if (reply.statusCode === 200 || reply.statusCode === 202 || reply.statusCode === 204) {
      reply.code(201);
    }
    return payload;
  });
}
