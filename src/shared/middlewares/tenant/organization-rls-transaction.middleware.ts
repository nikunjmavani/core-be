import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Result of awaiting the per-request RLS transaction settlement step in the request lifecycle.
 *
 * @remarks
 * - **Algorithm:** legacy request-pinned transactions were removed; settlement always reports
 *   `no_transaction` because org-scoped work runs in `withOrganizationDatabaseContext`.
 * - **Failure modes:** none — this is a compatibility stub for the lifecycle coordinator.
 * - **Side effects:** none.
 * - **Notes:** idempotency cache writes and on-commit dispatch proceed whenever settlement is
 *   `no_transaction` or `committed` (see `request-lifecycle.middleware.ts`).
 */
export type OrganizationRlsTransactionSettlementOutcome =
  | 'committed'
  | 'rolled_back'
  | 'no_transaction'
  | 'settle_failed';

/**
 * Compatibility no-op for the request lifecycle coordinator.
 *
 * @remarks
 * - **Algorithm:** returns `no_transaction` immediately — there is no outer HTTP transaction.
 * - **Failure modes:** none.
 * - **Side effects:** none.
 * - **Notes:** kept so post-response ordering (RLS settle → idempotency → outbox flush) stays stable.
 */
export async function settleAndAwaitOrganizationRlsTransaction(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<OrganizationRlsTransactionSettlementOutcome> {
  return 'no_transaction';
}

/**
 * Placeholder plugin retained for middleware registration order. Org-scoped HTTP handlers
 * must wrap database work in `withOrganizationDatabaseContext`; this middleware no longer
 * pins a pooled checkout for the full request.
 */
const organizationRlsTransactionMiddlewarePlugin: FastifyPluginAsync = async () => {
  /* no-op — scoped RLS contexts only */
};

export default fp(organizationRlsTransactionMiddlewarePlugin, {
  name: 'organization-rls-transaction-middleware',
});
