import type { AuditContainer } from '@/domains/audit/audit.container.js';
import { createAuditContainer } from '@/domains/audit/audit.container.js';
import type { AuthContainer } from '@/domains/auth/auth.container.js';
import { createAuthContainer } from '@/domains/auth/auth.container.js';
import type { BillingContainer } from '@/domains/billing/billing.container.js';
import { createBillingContainer } from '@/domains/billing/billing.container.js';
import type { NotifyContainer } from '@/domains/notify/notify.container.js';
import { createNotifyContainer } from '@/domains/notify/notify.container.js';
import type { TenancyContainer } from '@/domains/tenancy/tenancy.container.js';
import { createTenancyContainer } from '@/domains/tenancy/tenancy.container.js';
import type { UploadContainer } from '@/domains/upload/upload.container.js';
import { createUploadContainer } from '@/domains/upload/upload.container.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import type { UserContainer } from '@/domains/user/user.container.js';
import { completeUserContainer, createUserContainerBase } from '@/domains/user/user.container.js';
import { UserDataExportService } from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import { UserDataExportRepository } from '@/domains/user/sub-domains/user-data-export/user-data-export.repository.js';

/**
 * Aggregate of every domain container the API and worker processes need.
 * Built once at startup by {@link createDomainContainers} so cross-domain
 * service references are wired consistently.
 */
export type DomainContainers = {
  userDomain: UserContainer;
  tenancyDomain: TenancyContainer;
  auditDomain: AuditContainer;
  authDomain: AuthContainer;
  billingDomain: BillingContainer;
  notifyDomain: NotifyContainer;
  uploadDomain: UploadContainer;
};

/** Alias for the worker process composition root. */
export type WorkerContainers = DomainContainers;

/**
 * Builds all domain containers without Fastify (API and worker processes share this wiring).
 */
export function createDomainContainers(
  objectStorage: ObjectStoragePort = getDefaultS3ObjectStorageAdapter(),
): DomainContainers {
  const userBase = createUserContainerBase(objectStorage);
  const tenancyDomain = createTenancyContainer(userBase.userService, objectStorage);
  const authDomain = createAuthContainer(
    userBase.userService,
    tenancyDomain.organizationSettingsService,
  );
  const auditDomain = createAuditContainer(tenancyDomain.organizationService, userBase.userService);
  const billingDomain = createBillingContainer(tenancyDomain.organizationService);
  const notifyDomain = createNotifyContainer(
    tenancyDomain.organizationService,
    userBase.userService,
  );
  const uploadDomain = createUploadContainer(
    userBase.userService,
    tenancyDomain.organizationService,
    objectStorage,
  );

  const userDataExportRepository = new UserDataExportRepository();
  const userDataExportService = new UserDataExportService(
    userBase.userService,
    userDataExportRepository,
    objectStorage,
  );
  const userDomainWithRepository = completeUserContainer(userBase, userDataExportService);
  const userDomain: UserContainer = {
    userService: userDomainWithRepository.userService,
    userSettingsService: userDomainWithRepository.userSettingsService,
    userNotificationPreferencesService: userDomainWithRepository.userNotificationPreferencesService,
    userDataExportService: userDomainWithRepository.userDataExportService,
  };

  userDomain.userService.wireOffboardingServices({
    authSessionService: authDomain.authSessionService,
    authMethodService: authDomain.authMethodService,
    uploadService: uploadDomain.uploadService,
    userDataExportService: userDomain.userDataExportService,
  });

  tenancyDomain.organizationService.wireOffboardingUploadService(uploadDomain.uploadService);

  return {
    userDomain,
    tenancyDomain,
    auditDomain,
    authDomain,
    billingDomain,
    notifyDomain,
    uploadDomain,
  };
}

/** Worker process entry: same container graph as HTTP, without Fastify decorators. */
export function createWorkerContainers(): WorkerContainers {
  return createDomainContainers();
}
