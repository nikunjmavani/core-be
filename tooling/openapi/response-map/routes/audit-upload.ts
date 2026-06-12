/** OpenAPI success responses — audit and upload. */
import type { ResponseDefinition } from '@tooling/openapi/response-map/building-blocks.js';
import { wrapPaginated, wrapSuccess } from '@tooling/openapi/response-map/building-blocks.js';
import * as schemas from '@tooling/openapi/response-map/resource-schemas.js';

export const auditUploadRouteResponses: Record<string, ResponseDefinition> = {
  // ── Audit (admin) ──
  'GET /api/v1/audit/logs': {
    statusCode: 200,
    schema: wrapPaginated(schemas.auditLogSchema, [schemas.auditLogExample]),
    example: null,
  },

  // ── Upload ──
  'POST /api/v1/uploads': {
    statusCode: 201,
    schema: wrapSuccess(schemas.uploadSchema, schemas.uploadExample),
    example: null,
  },
  'DELETE /api/v1/uploads/{publicId}': { statusCode: 204, schema: null, example: null },
};
