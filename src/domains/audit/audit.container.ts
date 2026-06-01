import type { FastifyInstance } from 'fastify';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

/** Services exposed by the audit domain container (mounted on `app.auditDomain`). */
export type AuditContainer = {
  auditService: AuditService;
};

/**
 * Wires the audit repository and {@link AuditService} with its cross-domain
 * dependencies (tenancy + user services for public-id resolution).
 */
export function createAuditContainer(
  organizationService: OrganizationService,
  userService: UserService,
): AuditContainer {
  const auditRepository = new AuditRepository();
  const auditService = new AuditService(auditRepository, organizationService, userService);
  return { auditService };
}

/**
 * Fastify plugin step that decorates the application with the audit domain
 * container; must run after tenancy and user containers are registered.
 */
export function registerAuditContainer(application: FastifyInstance): void {
  const { organizationService } = application.tenancyDomain;
  const { userService } = application.userDomain;
  application.decorate('auditDomain', createAuditContainer(organizationService, userService));
}
