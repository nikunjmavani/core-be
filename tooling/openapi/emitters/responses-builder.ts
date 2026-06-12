import { EXTERNAL_ERROR_MESSAGE } from '@/shared/constants/index.js';
import { loadRouteSuccessStatusMap } from '@/tests/helpers/route-success-status.helper.js';
import { routeResponseMap } from '@tooling/openapi/response-map/index.js';
import { routeQuerySchemaMap } from '@tooling/openapi/query-schema-map.js';
import { loadCapturedRouteExamples } from '@tooling/openapi/route-examples/loader.js';

/** Sanitized request/response samples captured from real test-suite API calls. */
const capturedExamplesByRouteKey = loadCapturedRouteExamples();

/**
 * Attaches the captured live-call example for `(routeKey, statusCode)` to a
 * response object's JSON content when one exists in the committed fixture.
 */
function withCapturedExample(
  routeKey: string,
  statusCode: number | string,
  content: Record<string, unknown>,
): Record<string, unknown> {
  const captured = capturedExamplesByRouteKey[routeKey]?.responses?.[String(statusCode)];
  if (captured === undefined) {
    return content;
  }
  return {
    ...content,
    examples: {
      captured: {
        summary: 'Captured from a live API call in the test suite (sanitized)',
        value: captured,
      },
    },
  };
}

/**
 * Declared happy-path status per route from the success-status registry
 * (`tooling/openapi/route-catalog/route-success-statuses.json`), re-keyed to
 * the OpenAPI `{param}` path style. The registry is runtime truth (enforced by
 * the observed-status gate), so it is authoritative over the response map's
 * `statusCode` — a unit gate keeps the two aligned.
 */
const successStatusByOpenApiKey: Record<string, number> = Object.fromEntries(
  Object.entries(loadRouteSuccessStatusMap()).map(([routeKey, statusCode]) => [
    routeKey.replace(/:([A-Za-z_]+)/g, '{$1}'),
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
      const isMutatingSuccess = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
      responses[String(statusCode)] = {
        description,
        ...(isMutatingSuccess
          ? {
              headers: {
                'X-Idempotency-Replay': {
                  description:
                    'Present and `true` when this response was replayed from the idempotency cache for a reused Idempotency-Key.',
                  schema: { type: 'string', enum: ['true'] },
                },
              },
            }
          : {}),
        content: {
          'application/json': withCapturedExample(routeKey, statusCode, {
            schema,
            ...((schema as Record<string, unknown>).example
              ? { example: (schema as Record<string, unknown>).example }
              : {}),
          }),
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

  // Any body-carrying method can 400 (malformed JSON hits the parser even when the
  // route maps no JSON body; Stripe webhooks 400 on signature failure) — only
  // param-less, query-less GET/DELETE have truly nothing to validate.
  const acceptsBody = ['POST', 'PATCH', 'PUT'].includes(method);
  const hasPathParams = routeKey.includes('{');
  const hasQueryParams = routeKey in routeQuerySchemaMap;
  if (acceptsBody || hasPathParams || hasQueryParams) {
    responses['400'] = {
      description: translate('validationError', 'Validation error'),
      content: {
        'application/json': withCapturedExample(routeKey, 400, {
          schema: errorResponseSchema,
          example: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request body',
              details: [{ field: 'email', message: 'Invalid email format' }],
            },
            meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
          },
        }),
      },
    };
  }
  responses['401'] = {
    description: translate(
      'unauthorized',
      'Unauthorized — the Authorization header is missing, malformed, or carries an expired/revoked access token. Obtain a token via POST /api/v1/auth/login (or /auth/refresh) and send it as `Authorization: Bearer <ACCESS_TOKEN>`.',
    ),
    content: {
      'application/json': withCapturedExample(routeKey, 401, {
        schema: errorResponseSchema,
        example: {
          error: {
            code: 'UNAUTHORIZED',
            message:
              'Access token missing, expired, or revoked — authenticate via POST /api/v1/auth/login and retry with Authorization: Bearer <ACCESS_TOKEN>',
          },
          meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
        },
      }),
    },
  };
  responses['403'] = {
    description: translate('forbidden', 'Forbidden'),
    content: {
      'application/json': withCapturedExample(routeKey, 403, {
        schema: errorResponseSchema,
        example: {
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
          meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
        },
      }),
    },
  };
  responses['404'] = {
    description: translate('notFound', 'Not Found'),
    content: {
      'application/json': withCapturedExample(routeKey, 404, {
        schema: errorResponseSchema,
        example: {
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
          meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
        },
      }),
    },
  };
  if (routeKey.includes('/api/v1/mcp')) {
    // MCP streamable HTTP requires an Accept header naming a supported type.
    responses['406'] = {
      description: translate('notAcceptable', 'Not Acceptable'),
      content: {
        'application/json': withCapturedExample(routeKey, 406, {
          schema: errorResponseSchema,
          example: {
            error: { code: 'NOT_ACCEPTABLE', message: 'Accept header missing or unsupported' },
            meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
          },
        }),
      },
    };
  }
  const isMutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  if (isMutating) {
    // 409 covers resource/state conflicts AND the idempotency middleware's
    // in-flight duplicate (same Idempotency-Key while the first request runs).
    responses['409'] = {
      description: translate('conflict', 'Conflict'),
      content: {
        'application/json': withCapturedExample(routeKey, 409, {
          schema: errorResponseSchema,
          example: {
            error: { code: 'CONFLICT', message: 'Resource already exists or state conflict' },
            meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
          },
        }),
      },
    };
    // 422 covers business-rule rejections (UnprocessableEntityError) and the
    // idempotency middleware's key-reuse-with-different-payload fingerprint check,
    // which guards every mutating route accepting Idempotency-Key.
    responses['422'] = {
      description: translate('unprocessableEntity', 'Unprocessable Entity'),
      content: {
        'application/json': withCapturedExample(routeKey, 422, {
          schema: errorResponseSchema,
          example: {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: 'Business rule violation or idempotency key reused with a different payload',
            },
            meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
          },
        }),
      },
    };
  }
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    // Fastify-level body rejections on JSON-carrying methods.
    responses['413'] = {
      description: translate('payloadTooLarge', 'Payload Too Large'),
      content: {
        'application/json': withCapturedExample(routeKey, 413, {
          schema: errorResponseSchema,
          example: {
            error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' },
            meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
          },
        }),
      },
    };
    responses['415'] = {
      description: translate('unsupportedMediaType', 'Unsupported Media Type'),
      content: {
        'application/json': withCapturedExample(routeKey, 415, {
          schema: errorResponseSchema,
          example: {
            error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type' },
            meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
          },
        }),
      },
    };
  }
  // Every route sits behind the global + per-route rate limits.
  responses['429'] = {
    description: translate('tooManyRequests', 'Too Many Requests'),
    headers: {
      'Retry-After': {
        description: 'Seconds to wait before retrying.',
        schema: { type: 'integer' },
      },
      'X-RateLimit-Limit': {
        description: 'Request budget for the current window.',
        schema: { type: 'integer' },
      },
      'X-RateLimit-Remaining': {
        description: 'Requests left in the current window.',
        schema: { type: 'integer' },
      },
      'X-RateLimit-Reset': {
        description: 'Seconds until the window resets.',
        schema: { type: 'integer' },
      },
    },
    content: {
      'application/json': withCapturedExample(routeKey, 429, {
        schema: errorResponseSchema,
        example: {
          error: { code: 'RATE_LIMITED', message: 'Too many requests, retry later' },
          meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
        },
      }),
    },
  };
  responses['500'] = {
    description: translate('internalError', 'Internal Server Error'),
    content: {
      'application/json': withCapturedExample(routeKey, 500, {
        schema: errorResponseSchema,
        example: {
          error: { code: 'internal_error', detail: EXTERNAL_ERROR_MESSAGE },
          meta: { request_id: '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b' },
        },
      }),
    },
  };

  return responses;
}
