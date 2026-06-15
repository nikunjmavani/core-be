import type { FastifyInstance } from 'fastify';
import type { AuthorizationService } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { UploadRepository } from './upload.repository.js';
import { UploadService } from './upload.service.js';

/** Services exposed by the upload domain container (mounted on `app.uploadDomain`). */
export type UploadContainer = {
  uploadService: UploadService;
};

/**
 * Wires {@link UploadService} with its cross-domain dependencies (user +
 * organization services) and a pluggable {@link ObjectStoragePort} so tests
 * can substitute an in-memory storage adapter for the real S3 client.
 */
export function createUploadContainer(
  userService: UserService,
  organizationService: OrganizationService,
  objectStorage: ObjectStoragePort,
  authorizationService: AuthorizationService,
): UploadContainer {
  const uploadRepository = new UploadRepository();
  const uploadService = new UploadService(
    uploadRepository,
    userService,
    organizationService,
    objectStorage,
    authorizationService,
  );
  return { uploadService };
}

/**
 * Fastify plugin step that decorates the application with the upload domain
 * container, using the default S3 object-storage adapter. Must run after user
 * and tenancy containers are registered.
 */
export function registerUploadContainer(application: FastifyInstance): void {
  const { userService } = application.userDomain;
  const { organizationService, authorizationService } = application.tenancyDomain;
  application.decorate(
    'uploadDomain',
    createUploadContainer(
      userService,
      organizationService,
      getDefaultS3ObjectStorageAdapter(),
      authorizationService,
    ),
  );
}
