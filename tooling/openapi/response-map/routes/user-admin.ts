/** OpenAPI success responses — admin user management. */
import type { ResponseDefinition } from '@tooling/openapi/response-map/building-blocks.js';
import { wrapPaginated, wrapSuccess } from '@tooling/openapi/response-map/building-blocks.js';
import * as schemas from '@tooling/openapi/response-map/resource-schemas.js';

export const userAdminRouteResponses: Record<string, ResponseDefinition> = {
  'GET /api/v1/users': {
    statusCode: 200,
    schema: wrapPaginated(schemas.userSchema, [schemas.userExample]),
    example: null,
  },
  'GET /api/v1/users/{user_id}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, schemas.userExample),
    example: null,
  },
  'PATCH /api/v1/users/{user_id}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, schemas.userExample),
    example: null,
  },
  'DELETE /api/v1/users/{user_id}': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/users/{user_id}/suspend': {
    statusCode: 201,
    schema: wrapSuccess(schemas.userSchema, { ...schemas.userExample, status: 'SUSPENDED' }),
    example: null,
  },
  'POST /api/v1/users/{user_id}/unsuspend': {
    statusCode: 201,
    schema: wrapSuccess(schemas.userSchema, { ...schemas.userExample, status: 'ACTIVE' }),
    example: null,
  },
};
