import { EXTERNAL_ERROR_MESSAGE } from '@/shared/constants/index.js';
import { loadRouteSuccessStatusMap } from '@/tests/helpers/route-success-status.helper.js';
import { routeResponseMap } from '@tooling/openapi/response-map/index.js';
import { routeQuerySchemaMap } from '@tooling/openapi/query-schema-map.js';
import { routeSchemaMap } from '@tooling/openapi/schema-map.js';
import {
  PARAM_NAME_TO_ENTITY,
  PUBLIC_ID_PREFIXES,
} from '@/shared/utils/identity/public-id.util.js';
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
        type: {
          type: 'string',
          enum: ['request_error', 'validation_error'],
          description:
            'Possible values: request_error | validation_error — validation_error carries the per-field `errors` array',
          example: 'request_error',
        },
        code: {
          type: 'string',
          description:
            'Machine-readable snake_case error code (e.g. unauthorized, forbidden, not_found, conflict, invalid_field)',
        },
        detail: { type: 'string', description: 'Human-readable explanation of what went wrong' },
        documentation_url: {
          type: 'string',
          description: 'Link to the documentation page for this error code',
        },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                description:
                  'Offending field, prefixed by its location: `body.<field>`, `params.<param>`, or `query.<field>`',
              },
              message: { type: 'string' },
            },
          },
          description: 'Per-field validation errors (400 validation_error responses only)',
        },
      },
      required: ['type', 'code', 'detail'],
    },
    meta: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'Server-minted request UUID — quote it in support tickets',
        },
      },
      required: ['request_id'],
    },
  },
};

const EXAMPLE_REQUEST_ID = '018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b';
const EXAMPLE_DOCUMENTATION_URL = 'https://example.com/resource';

/** Builds a real-envelope error example: `{ error: { type, code, detail, documentation_url, errors? }, meta }`. */
function errorExample(
  type: 'request_error' | 'validation_error',
  code: string,
  detail: string,
  errors?: { field: string; message: string }[],
): Record<string, unknown> {
  return {
    error: {
      type,
      code,
      detail,
      documentation_url: EXAMPLE_DOCUMENTATION_URL,
      ...(errors?.length ? { errors } : {}),
    },
    meta: { request_id: EXAMPLE_REQUEST_ID },
  };
}

/**
 * Derives this route's own per-field 400 `errors` array — body fields first
 * (from the request schema map), then path params (with their exact id
 * pattern), then query fields — so every fallback 400 example names fields the
 * route actually validates instead of a generic placeholder.
 */
function validationErrorsFor(routeKey: string): { field: string; message: string }[] {
  const bodySchema = routeSchemaMap[routeKey] as { shape?: Record<string, unknown> } | undefined;
  const bodyFields = bodySchema?.shape ? Object.keys(bodySchema.shape) : [];
  if (bodyFields.length > 0) {
    return bodyFields.slice(0, 2).map((field) => ({
      field: `body.${field}`,
      message: 'Required',
    }));
  }
  const paramMatch = /\{([a-z_]+)\}/.exec(routeKey);
  if (paramMatch) {
    const param = paramMatch[1]!;
    const entity = PARAM_NAME_TO_ENTITY[param as keyof typeof PARAM_NAME_TO_ENTITY];
    return [
      {
        field: `params.${param}`,
        message: entity
          ? `Invalid string: must match pattern /^${PUBLIC_ID_PREFIXES[entity]}_[a-z0-9]{21}$/`
          : 'Invalid value',
      },
    ];
  }
  const querySchema = routeQuerySchemaMap[routeKey] as
    | { shape?: Record<string, unknown> }
    | undefined;
  const queryFields = querySchema?.shape ? Object.keys(querySchema.shape) : [];
  if (queryFields.length > 0) {
    return [{ field: `query.${queryFields[0]}`, message: 'Invalid value' }];
  }
  return [{ field: 'body', message: 'Malformed JSON body' }];
}

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
          example: errorExample(
            'validation_error',
            'invalid_field',
            'Invalid values for fields in request',
            validationErrorsFor(routeKey),
          ),
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
        example: errorExample(
          'request_error',
          'unauthorized',
          'Access token missing, expired, or revoked — authenticate via POST /api/v1/auth/login and retry with Authorization: Bearer <ACCESS_TOKEN>',
        ),
      }),
    },
  };
  responses['403'] = {
    description: translate('forbidden', 'Forbidden'),
    content: {
      'application/json': withCapturedExample(routeKey, 403, {
        schema: errorResponseSchema,
        example: errorExample(
          'request_error',
          'forbidden',
          'Your role lacks the permission this operation requires in the current organization',
        ),
      }),
    },
  };
  responses['404'] = {
    description: translate('notFound', 'Not Found'),
    content: {
      'application/json': withCapturedExample(routeKey, 404, {
        schema: errorResponseSchema,
        example: errorExample('request_error', 'not_found', 'Resource not found'),
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
          example: errorExample(
            'request_error',
            'not_acceptable',
            'Accept header missing or names an unsupported media type',
          ),
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
          example: errorExample(
            'request_error',
            'conflict',
            'Resource already exists or the current state does not allow this transition',
          ),
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
          example: errorExample(
            'request_error',
            'unprocessable_entity',
            'Business rule violation or Idempotency-Key reused with a different payload',
          ),
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
          example: errorExample(
            'request_error',
            'payload_too_large',
            'Request body exceeds the size limit',
          ),
        }),
      },
    };
    responses['415'] = {
      description: translate('unsupportedMediaType', 'Unsupported Media Type'),
      content: {
        'application/json': withCapturedExample(routeKey, 415, {
          schema: errorResponseSchema,
          example: errorExample(
            'request_error',
            'unsupported_media_type',
            'Content-Type must be application/json',
          ),
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
        example: errorExample(
          'request_error',
          'rate_limited',
          'Too many requests — wait Retry-After seconds before retrying',
        ),
      }),
    },
  };
  responses['500'] = {
    description: translate('internalError', 'Internal Server Error'),
    content: {
      'application/json': withCapturedExample(routeKey, 500, {
        schema: errorResponseSchema,
        example: errorExample('request_error', 'internal_error', EXTERNAL_ERROR_MESSAGE),
      }),
    },
  };

  return responses;
}
