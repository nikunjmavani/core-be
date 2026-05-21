import type { FastifyInstance } from 'fastify';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

export type AuditContainer = {
  auditService: AuditService;
};

export function createAuditContainer(
  organizationService: OrganizationService,
  userService: UserService,
): AuditContainer {
  const auditRepository = new AuditRepository();
  const auditService = new AuditService(auditRepository, organizationService, userService);
  return { auditService };
}

export function registerAuditContainer(application: FastifyInstance): void {
  const { organizationService } = application.tenancyDomain;
  const { userService } = application.userDomain;
  application.decorate('auditDomain', createAuditContainer(organizationService, userService));
}
