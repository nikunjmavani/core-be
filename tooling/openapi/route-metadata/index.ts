/**
 * Maps "METHOD /openapi/path" → human-readable summary, description, and tags.
 */
export type { RouteMetadata } from './types.js';

import { auditUploadMetadata } from './audit-upload.js';
import { billingNotifyMetadata } from './billing-notify.js';
import { healthMcpAuthMetadata } from './health-mcp-auth.js';
import { tenancyMetadata } from './tenancy.js';
import { userAdminMetadata } from './user-admin.js';

export const routeMetadataMap: Record<string, import('./types.js').RouteMetadata> = {
  ...healthMcpAuthMetadata,
  ...userAdminMetadata,
  ...tenancyMetadata,
  ...billingNotifyMetadata,
  ...auditUploadMetadata,
};
