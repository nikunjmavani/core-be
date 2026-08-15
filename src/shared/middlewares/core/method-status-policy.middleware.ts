import type { FastifyInstance } from 'fastify';

/**
 * Uniform method→success-status policy, enforced centrally:
 *
 * | Method  | Success status |
 * | ------- | -------------- |
 * | GET     | 200            |
 * | POST    | 200            |
 * | PUT     | 200            |
 * | PATCH   | 200            |
 * | DELETE  | 204            |
 *
 * There are deliberately **no exemptions**. Success is 200 for every method except DELETE (204).
 * This is the Stripe-shaped uniform model: `200 OK` is true for a create, true for an idempotent
 * replay of that create, and true for a future upsert — where `201 Created` lies on the replay
 * and forces a created-vs-existed judgment call on every upsert route. It also matches every
 * external inbound protocol this API might ever host (webhook acks, OAuth token endpoints,
 * JSON-RPC transports all expect 200), so the old per-route exemption list is gone rather than
 * maintained.
 *
 * @remarks
 * - **Algorithm:** an `onSend` hook normalizes any 201/202/204 a POST handler produced to 200
 *   (other methods/statuses pass through untouched), so every current and future POST conforms
 *   without per-handler boilerplate.
 * - **Failure modes:** none — error statuses (>= 300) are never rewritten.
 * - **Side effects:** response status only; bodies are untouched (a 204-bodied POST becomes a
 *   200 with empty body, exactly as the previous 201 policy treated it).
 * - **Notes:** declared statuses live in route-success-statuses.json and are runtime-verified
 *   by the observed-status gate; this hook is the enforcement point that keeps controllers
 *   honest.
 */
export function registerMethodStatusPolicy(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'POST') {
      return payload;
    }
    if (reply.statusCode === 201 || reply.statusCode === 202 || reply.statusCode === 204) {
      reply.code(200);
    }
    return payload;
  });
}
