/** OpenAPI route metadata — audit and upload. */
import type { RouteMetadata } from './types.js';

export const auditUploadMetadata: Record<string, RouteMetadata> = {
  // ── Audit ──
  'GET /api/v1/audit/logs': {
    summary: 'List audit logs (admin)',
    description:
      'Returns audit log entries with cursor pagination (`after`, `limit`). Requires SUPER_ADMIN or ADMIN role.',
    tags: ['Admin', 'Audit Log'],
  },

  // ── Upload ──
  'POST /api/v1/uploads': {
    summary: 'Request pre-signed upload URL',
    description:
      'Returns a pre-signed S3 URL for direct file upload. Specify the file purpose, content type, and size.',
    tags: ['Upload'],
  },
  'GET /api/v1/uploads/{publicId}': {
    summary: 'Get upload metadata',
    description:
      'Returns metadata for a previously requested upload owned by the authenticated user.',
    tags: ['Upload'],
  },
  'DELETE /api/v1/uploads/{publicId}': {
    summary: 'Delete upload',
    description:
      'Soft-deletes the upload record and removes the object from storage when possible.',
    tags: ['Upload'],
  },
};
