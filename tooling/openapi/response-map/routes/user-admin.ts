/** OpenAPI success responses — admin user management. */
import type { ResponseDefinition } from '../building-blocks.js';
import { wrapPaginated, wrapSuccess } from '../building-blocks.js';
import * as schemas from '../resource-schemas.js';

export const userAdminRouteResponses: Record<string, ResponseDefinition> = {
  'GET /api/v1/users': {
    statusCode: 200,
    schema: wrapPaginated(schemas.userSchema, [schemas.userExample]),
    example: null,
  },
  'GET /api/v1/users/{userId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, schemas.userExample),
    example: null,
  },
  'PATCH /api/v1/users/{userId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, schemas.userExample),
    example: null,
  },
  'DELETE /api/v1/users/{userId}': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/users/{userId}/suspend': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, { ...schemas.userExample, status: 'SUSPENDED' }),
    example: null,
  },
  'POST /api/v1/users/{userId}/unsuspend': {
    statusCode: 200,
    schema: wrapSuccess(schemas.userSchema, { ...schemas.userExample, status: 'ACTIVE' }),
    example: null,
  },
};
