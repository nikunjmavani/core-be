/** OpenAPI success responses — audit and upload. */
import type { ResponseDefinition } from '../building-blocks.js';
import { wrapPaginated, wrapSuccess } from '../building-blocks.js';
import * as schemas from '../resource-schemas.js';

export const auditUploadRouteResponses: Record<string, ResponseDefinition> = {
  // ── Audit (admin) ──
  'GET /api/v1/audit/logs': {
    statusCode: 200,
    schema: wrapPaginated(schemas.auditLogSchema, [schemas.auditLogExample]),
    example: null,
  },

  // ── Upload ──
  'POST /api/v1/uploads': {
    statusCode: 200,
    schema: wrapSuccess(schemas.uploadSchema, schemas.uploadExample),
    example: null,
  },
};
