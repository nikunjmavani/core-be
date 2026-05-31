import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerAuditContainer } from '@/domains/audit/audit.container.js';
import { registerAuthContainer } from '@/domains/auth/auth.container.js';
import { registerBillingContainer } from '@/domains/billing/billing.container.js';
import { registerNotifyContainer } from '@/domains/notify/notify.container.js';
import { registerTenancyContainer } from '@/domains/tenancy/tenancy.container.js';
import { registerUploadContainer } from '@/domains/upload/upload.container.js';
import { registerUserContainer } from '@/domains/user/user.container.js';

async function registerDomainContainers(application: FastifyInstance): Promise<void> {
  registerUserContainer(application);
  registerTenancyContainer(application);
  registerAuditContainer(application);
  registerAuthContainer(application);
  registerBillingContainer(application);
  registerNotifyContainer(application);
  registerUploadContainer(application);

  application.userDomain.userService.wireOffboardingServices({
    authSessionService: application.authDomain.authSessionService,
    authMethodService: application.authDomain.authMethodService,
    uploadService: application.uploadDomain.uploadService,
    userDataExportService: application.userDomain.userDataExportService,
  });

  application.tenancyDomain.organizationService.wireOffboardingUploadService(
    application.uploadDomain.uploadService,
  );

  application.userDomain.userDataExportService.wireCrossDomainServices({
    authSessionService: application.authDomain.authSessionService,
    membershipService: application.tenancyDomain.membershipService,
    notificationService: application.notifyDomain.notificationService,
    auditService: application.auditDomain.auditService,
  });
}

/** Registers all domain containers on the Fastify instance (composition root). */
export const domainContainersPlugin = fp(registerDomainContainers, {
  name: 'domain-containers',
});
