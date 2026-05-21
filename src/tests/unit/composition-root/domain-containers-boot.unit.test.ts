/**
 * Boot test: `createDomainContainers()` assembles every domain at boot, wires the
 * two-phase offboarding services (user, organization) deterministically, and
 * returns the same shape across HTTP and worker entrypoints.
 *
 * Backs plan #53 (`p2-replace-attach`).
 */
import { describe, expect, it } from 'vitest';
import { createDomainContainers, createWorkerContainers } from '@/worker-containers.js';

describe('domain containers — boot composition root', () => {
  it('builds every domain container at boot', () => {
    const containers = createDomainContainers();

    expect(containers.userDomain.userService).toBeDefined();
    expect(containers.userDomain.userDataExportService).toBeDefined();
    expect(containers.userDomain.userSettingsService).toBeDefined();
    expect(containers.userDomain.userNotificationPreferencesService).toBeDefined();

    expect(containers.tenancyDomain.organizationService).toBeDefined();
    expect(containers.tenancyDomain.membershipService).toBeDefined();
    expect(containers.tenancyDomain.authorizationService).toBeDefined();
    expect(containers.tenancyDomain.permissionService).toBeDefined();

    expect(containers.authDomain.authService).toBeDefined();
    expect(containers.authDomain.authSessionService).toBeDefined();
    expect(containers.authDomain.authMethodService).toBeDefined();

    expect(containers.auditDomain.auditService).toBeDefined();
    expect(containers.billingDomain.stripeWebhookService).toBeDefined();
    expect(containers.notifyDomain.notificationService).toBeDefined();
    expect(containers.notifyDomain.webhookService).toBeDefined();
    expect(containers.uploadDomain.uploadService).toBeDefined();
  });

  it('wires user offboarding services on UserService at boot (no late attach)', () => {
    const containers = createDomainContainers();
    type WiredUserService = {
      authSessionService: unknown;
      authMethodService: unknown;
      offboardingUploadService: unknown;
    };
    const userService = containers.userDomain.userService as unknown as WiredUserService;

    expect(userService.authSessionService).toBe(containers.authDomain.authSessionService);
    expect(userService.authMethodService).toBe(containers.authDomain.authMethodService);
    expect(userService.offboardingUploadService).toBe(containers.uploadDomain.uploadService);
  });

  it('wires upload offboarding on OrganizationService at boot (no late attach)', () => {
    const containers = createDomainContainers();
    type WiredOrganizationService = { offboardingUploadService: unknown };
    const organizationService = containers.tenancyDomain
      .organizationService as unknown as WiredOrganizationService;

    expect(organizationService.offboardingUploadService).toBe(
      containers.uploadDomain.uploadService,
    );
  });

  it('createWorkerContainers and createDomainContainers expose the same domain keys', () => {
    const workerRoot = createWorkerContainers();
    const apiRoot = createDomainContainers();
    expect(Object.keys(workerRoot).sort()).toEqual(Object.keys(apiRoot).sort());
  });
});
