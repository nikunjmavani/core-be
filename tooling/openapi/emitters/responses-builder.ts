import { EXTERNAL_ERROR_MESSAGE } from '@/shared/constants/index.js';
import { loadRouteSuccessStatusMap } from '@/tests/helpers/route-success-status.helper.js';
import { routeResponseMap } from '@tooling/openapi/response-map/index.js';

/**
 * Declared happy-path status per route from the success-status registry
 * (`tooling/openapi/route-catalog/route-success-statuses.json`), re-keyed to
 * the OpenAPI `{param}` path style. The registry is runtime truth (enforced by
 * the observed-status gate), so it is authoritative over the response map's
 * `statusCode` — a unit gate keeps the two aligned.
 */
const successStatusByOpenApiKey: Record<string, number> = Object.fromEntries(
  Object.entries(loadRouteSuccessStatusMap()).map(([routeKey, statusCode]) => [
    routeKey.replace(/:([A-Za-z]+)/g, '{$1}'),
    statusCode,
  ]),
);

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Machine-readable error code' },
        message: { type: 'string', description: 'Human-readable error message' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
          },
          description: 'Field-level validation errors (only for 400 responses)',
          nullable: true,
        },
      },
      required: ['code', 'message'],
    },
    meta: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
      },
    },
  },
};

export function buildResponses(
  method: string,
  routeKey: string,
  responseStrings: Record<string, string>,
): Record<string, object> {
  const responseDefinition = routeResponseMap[routeKey];
  const responses: Record<string, object> = {};
  const translate = (key: string, fallback: string) => responseStrings[key] ?? fallback;

  // The registry is authoritative for the success status; the response map
  // contributes the body schema/example. Routes outside the registry (none
  // today — the catalog sync gate guarantees registry completeness) fall back
  // to the response map's own statusCode, then 200.
  const declaredStatus = successStatusByOpenApiKey[routeKey];

  if (responseDefinition) {
    const statusCode = declaredStatus ?? responseDefinition.statusCode;
    const { schema } = responseDefinition;

    if (schema === null || statusCode === 204) {
      responses[String(statusCode)] = { description: translate('noContent', 'No Content') };
    } else {
      const description =
        statusCode === 201
          ? translate('created', 'Resource created successfully')
          : translate('success', 'Successful operation');
      responses[String(statusCode)] = {
        description,
        content: {
          'application/json': {
            schema,
            ...((schema as Record<string, unknown>).example
              ? { example: (schema as Record<string, unknown>).example }
              : {}),
          },
        },
      };
    }
  } else {
    const statusCode = declaredStatus ?? 200;
    const description =
      statusCode === 204
        ? translate('noContent', 'No Content')
        : statusCode === 201
          ? translate('created', 'Resource created successfully')
          : translate('success', 'Successful operation');
    responses[String(statusCode)] = { description };
  }

  responses['400'] = {
    description: translate('validationError', 'Validation error'),
    content: {
      'application/json': {
        schema: errorResponseSchema,
        example: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: [{ field: 'email', message: 'Invalid email format' }],
          },
          meta: { request_id: 'req_a1b2c3d4e5f6' },
        },
      },
    },
  };
  responses['401'] = {
    description: translate('unauthorized', 'Unauthorized'),
    content: {
      'application/json': {
        schema: errorResponseSchema,
        example: {
          error: { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' },
          meta: { request_id: 'req_a1b2c3d4e5f6' },
        },
      },
    },
  };
  responses['403'] = {
    description: translate('forbidden', 'Forbidden'),
    content: {
      'application/json': {
        schema: errorResponseSchema,
        example: {
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
          meta: { request_id: 'req_a1b2c3d4e5f6' },
        },
      },
    },
  };
  responses['404'] = {
    description: translate('notFound', 'Not Found'),
    content: {
      'application/json': {
        schema: errorResponseSchema,
        example: {
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
          meta: { request_id: 'req_a1b2c3d4e5f6' },
        },
      },
    },
  };
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    responses['409'] = {
      description: translate('conflict', 'Conflict'),
      content: {
        'application/json': {
          schema: errorResponseSchema,
          example: {
            error: { code: 'CONFLICT', message: 'Resource already exists or state conflict' },
            meta: { request_id: 'req_a1b2c3d4e5f6' },
          },
        },
      },
    };
  }
  responses['500'] = {
    description: translate('internalError', 'Internal Server Error'),
    content: {
      'application/json': {
        schema: errorResponseSchema,
        example: {
          error: { code: 'internal_error', detail: EXTERNAL_ERROR_MESSAGE },
          meta: { request_id: 'req_a1b2c3d4e5f6' },
        },
      },
    },
  };

  return responses;
}
