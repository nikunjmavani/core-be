import type { FastifyRequest } from 'fastify';
import type { AuditLogRecordInput } from '@/domains/audit/audit.types.js';
import type { AuthContext } from '@/shared/types/index.js';
import { isApiKeyPrincipal } from '@/shared/utils/http/request.util.js';
import { recordAuditEvent } from '@/shared/utils/infrastructure/audit-record.util.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';

/**
 * Derives the audit actor fields from an authenticated principal: an organization API-key
 * principal is recorded as `actorApiKeyPublicId`, a user principal as `actorUserPublicId`. Spread
 * the result into a {@link recordScopedAuditEvent} input so API-key-driven mutations are attributed
 * (the audit row carries a key actor) instead of being silently dropped for lack of a user.
 */
export function buildAuditActorFields(auth: AuthContext): {
  actorUserPublicId?: string;
  actorApiKeyPublicId?: string;
} {
  return isApiKeyPrincipal(auth)
    ? { actorApiKeyPublicId: auth.apiKeyPublicId }
    : { actorUserPublicId: auth.userId };
}

/** Extracts `ip_address` and `user_agent` from the Fastify request for audit log fields; either may be `null`. */
export function getAuditRequestNetworkContext(request: FastifyRequest): {
  ip_address: string | null;
  user_agent: string | null;
} {
  return {
    ip_address: request.ip ?? null,
    user_agent:
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

/**
 * Looks up the internal organization id for an audit row. Called from controllers
 * AFTER the wrapped service call has returned, so no scoped DB context is active.
 * Under `DATABASE_RLS_SCOPED_CONTEXTS=true` the `organizations_tenant_isolation`
 * policy requires either `app.current_organization_id` (not available here) or
 * `app.current_user_id` plus the `organizations_user_discovery` policy. We wrap
 * in `withUserDatabaseContext` when the request is authenticated so the discovery
 * policy applies; unauthenticated audit recordings fall back to a best-effort
 * lookup (and the audit row simply records a null organization_id when blocked).
 */
export async function resolveOrganizationIdForAudit(
  request: FastifyRequest,
  organizationPublicId: string,
): Promise<number | null> {
  const organizationService = request.server.tenancyDomain?.organizationService;
  if (!organizationService) {
    return null;
  }
  const userPublicId = request.auth?.kind === 'user' ? request.auth.userId : undefined;
  if (typeof userPublicId === 'string' && userPublicId.length > 0) {
    const organization = await withUserDatabaseContext(userPublicId, () =>
      organizationService.findOrganizationByPublicId(organizationPublicId),
    );
    return organization?.id ?? null;
  }
  const organization = await organizationService.findOrganizationByPublicId(organizationPublicId);
  return organization?.id ?? null;
}

type ScopedAuditInput = Omit<
  AuditLogRecordInput,
  'ip_address' | 'user_agent' | 'organization_id'
> & {
  organizationPublicId?: string;
};

/**
 * Records an audit row with request network context and optional organization_id resolution.
 */
export async function recordScopedAuditEvent(
  request: FastifyRequest,
  input: ScopedAuditInput,
): Promise<void> {
  const network = getAuditRequestNetworkContext(request);
  const { organizationPublicId, ...rest } = input;
  let organization_id: number | null = null;
  if (organizationPublicId) {
    organization_id = await resolveOrganizationIdForAudit(request, organizationPublicId);
  }
  await recordAuditEvent(
    request.server.auditDomain.auditService,
    { ...rest, ...network, organization_id },
    request.log,
  );
}
