import { EXTERNAL_ERROR_MESSAGE } from '@/shared/constants/index.js';
import { routeResponseMap } from '@tooling/openapi/response-map/index.js';

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

  if (responseDefinition) {
    const { statusCode, schema } = responseDefinition;

    if (schema === null) {
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
    responses['200'] = { description: translate('success', 'Successful operation') };
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
