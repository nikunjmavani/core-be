import type { FastifyInstance } from 'fastify';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { UploadRepository } from './upload.repository.js';
import { UploadService } from './upload.service.js';

export type UploadContainer = {
  uploadService: UploadService;
};

export function createUploadContainer(
  userService: UserService,
  organizationService: OrganizationService,
  objectStorage: ObjectStoragePort,
): UploadContainer {
  const uploadRepository = new UploadRepository();
  const uploadService = new UploadService(
    uploadRepository,
    userService,
    organizationService,
    objectStorage,
  );
  return { uploadService };
}

export function registerUploadContainer(application: FastifyInstance): void {
  const { userService } = application.userDomain;
  const { organizationService } = application.tenancyDomain;
  application.decorate(
    'uploadDomain',
    createUploadContainer(userService, organizationService, getDefaultS3ObjectStorageAdapter()),
  );
}
