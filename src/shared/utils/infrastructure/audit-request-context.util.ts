import type { FastifyRequest } from 'fastify';
import type { AuditLogRecordInput } from '@/domains/audit/audit.types.js';
import { recordAuditEvent } from '@/shared/utils/infrastructure/audit-record.util.js';

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

export async function resolveOrganizationIdForAudit(
  request: FastifyRequest,
  organizationPublicId: string,
): Promise<number | null> {
  const organizationService = request.server.tenancyDomain?.organizationService;
  if (!organizationService) {
    return null;
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
