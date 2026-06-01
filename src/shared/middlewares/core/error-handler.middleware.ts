import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { AppError, ERROR_CODE_TO_SNAKE, ValidationError } from '@/shared/errors/index.js';
import { EXTERNAL_ERROR_MESSAGE } from '@/shared/constants/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { captureException } from '@/infrastructure/observability/sentry/sentry.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { env } from '@/shared/config/env.config.js';
import {
  isFastifyRequestTimeoutError,
  isPostgresStatementTimeoutError,
} from '@/shared/utils/infrastructure/timeout-error.util.js';

function getRequestId(request: { id?: string }): string {
  return request.id ?? randomUUID();
}

function getDocsBaseUrl(): string {
  return env.API_DOCS_BASE_URL ?? 'https://docs.example.com/errors';
}

function buildErrorPayload(
  type: 'request_error' | 'validation_error',
  code: string,
  detail: string,
  errors?: { field: string; message: string }[],
) {
  const payload: {
    type: string;
    code: string;
    detail: string;
    documentation_url?: string;
    errors?: { field: string; message: string }[];
  } = {
    type,
    code,
    detail,
    documentation_url: `${getDocsBaseUrl()}/${code}`,
  };
  if (errors?.length) payload.errors = errors;
  return payload;
}

function translateDetail(
  request: Pick<FastifyRequest, 't'>,
  key: string,
  params?: Record<string, string | number>,
  fallback: string = key,
): string {
  const translate = request.t;
  if (translate) {
    return translate(key, params ?? {});
  }
  return fallback;
}

type FastifyValidationIssue = {
  instancePath?: string;
  params?: { missingProperty?: string };
  message?: string;
};

type FastifyValidationError = Error & {
  statusCode?: number;
  code: string;
  validation: FastifyValidationIssue[];
  validationContext?: string;
};

function isFastifyValidationError(error: unknown): error is FastifyValidationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'FST_ERR_VALIDATION' &&
    'validation' in error &&
    Array.isArray((error as { validation: unknown }).validation)
  );
}

function mapFastifyValidationField(
  issue: FastifyValidationIssue,
  validationContext?: string,
): string {
  if (issue.params?.missingProperty) {
    return issue.params.missingProperty;
  }
  const pathSegment = issue.instancePath?.replace(/^\//, '') ?? '';
  if (pathSegment.length > 0) {
    return validationContext ? `${validationContext}.${pathSegment}` : pathSegment;
  }
  return validationContext ?? 'body';
}

interface ErrorResponseBody {
  error: ReturnType<typeof buildErrorPayload>;
  meta: { request_id: string };
}

function buildTimeoutResponse(
  request: FastifyRequest,
  requestId: string,
  options: {
    translationKey: string;
    fallbackMessage: string;
    code: 'request_timeout' | 'gateway_timeout';
  },
): ErrorResponseBody {
  const detail = translateDetail(request, options.translationKey, {}, options.fallbackMessage);
  return {
    error: buildErrorPayload('request_error', options.code, detail),
    meta: { request_id: requestId },
  };
}

function handleAppErrorResponse(
  error: AppError,
  request: FastifyRequest,
  requestId: string,
): ErrorResponseBody {
  if (error.statusCode >= 500) {
    captureException(
      error,
      omitUndefined({
        requestId,
        userId: request.auth?.kind === 'user' ? request.auth.userId : undefined,
        organizationId: request.organizationId ?? undefined,
      }),
    );
  }
  const code = ERROR_CODE_TO_SNAKE[error.code];
  const isValidation = error instanceof ValidationError;
  const detail =
    error.statusCode >= 500
      ? translateDetail(request, 'errors:internal', {}, EXTERNAL_ERROR_MESSAGE)
      : translateDetail(request, error.messageKey, error.messageParams, error.message);
  const errors =
    isValidation && error.errors
      ? error.errors.map((item) => ({
          field: item.field,
          message:
            item.messageKey && request.t
              ? request.t(item.messageKey, item.messageParams ?? {})
              : (item.message ?? item.messageKey ?? 'Invalid'),
        }))
      : undefined;
  return {
    error: buildErrorPayload(
      isValidation ? 'validation_error' : 'request_error',
      code,
      detail,
      errors,
    ),
    meta: { request_id: requestId },
  };
}

function handleZodErrorResponse(
  error: ZodError,
  request: FastifyRequest,
  requestId: string,
): ErrorResponseBody {
  const detail = translateDetail(
    request,
    'errors:invalidFields',
    {},
    'Invalid values for fields in request',
  );
  const errors = Object.entries(z.flattenError(error).fieldErrors).map(([field, message]) => ({
    field,
    message: Array.isArray(message) ? message.join(', ') : String(message ?? 'Invalid'),
  }));
  return {
    error: buildErrorPayload('validation_error', 'invalid_field', detail, errors),
    meta: { request_id: requestId },
  };
}

function handleFastifyValidationErrorResponse(
  error: FastifyValidationError,
  request: FastifyRequest,
  requestId: string,
): ErrorResponseBody {
  const detail = translateDetail(
    request,
    'errors:invalidFields',
    {},
    'Invalid values for fields in request',
  );
  const errors = error.validation.map((issue) => ({
    field: mapFastifyValidationField(issue, error.validationContext),
    message: issue.message ?? 'Invalid',
  }));
  return {
    error: buildErrorPayload('validation_error', 'invalid_field', detail, errors),
    meta: { request_id: requestId },
  };
}

function handleUnhandledErrorResponse(
  error: unknown,
  request: FastifyRequest,
  requestId: string,
): ErrorResponseBody {
  captureException(
    error,
    omitUndefined({
      requestId,
      userId: request.auth?.kind === 'user' ? request.auth.userId : undefined,
      organizationId: request.organizationId ?? undefined,
    }),
  );
  logger.error({ error, requestId }, 'Unhandled error');
  const internalDetail = translateDetail(request, 'errors:internal', {}, EXTERNAL_ERROR_MESSAGE);
  return {
    error: buildErrorPayload('request_error', 'internal_error', internalDetail),
    meta: { request_id: requestId },
  };
}

const errorHandlerMiddlewarePlugin: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler(async (request, reply) => {
    const requestId = getRequestId(request as { id?: string });
    const detail = translateDetail(request, 'errors:routeNotFound', {}, 'Route not found');
    reply.status(404);
    return {
      error: buildErrorPayload('request_error', 'not_found', detail),
      meta: { request_id: requestId },
    };
  });

  app.setErrorHandler(async (error, request, reply) => {
    const currentRequestId = getRequestId(request as { id?: string });

    if (isFastifyRequestTimeoutError(error)) {
      logger.warn({ requestId: currentRequestId }, 'request.timeout');
      reply.status(408);
      return buildTimeoutResponse(request, currentRequestId, {
        translationKey: 'errors:requestTimeout',
        fallbackMessage: 'The request took too long to complete',
        code: 'request_timeout',
      });
    }

    if (isPostgresStatementTimeoutError(error)) {
      logger.warn({ requestId: currentRequestId }, 'database.statement_timeout');
      reply.status(504);
      return buildTimeoutResponse(request, currentRequestId, {
        translationKey: 'errors:databaseTimeout',
        fallbackMessage: 'The database operation timed out',
        code: 'gateway_timeout',
      });
    }

    if (error instanceof AppError) {
      reply.status(error.statusCode);
      return handleAppErrorResponse(error, request, currentRequestId);
    }

    if (error instanceof ZodError) {
      reply.status(400);
      return handleZodErrorResponse(error, request, currentRequestId);
    }

    if (isFastifyValidationError(error)) {
      reply.status(error.statusCode ?? 400);
      return handleFastifyValidationErrorResponse(error, request, currentRequestId);
    }

    reply.status(500);
    return handleUnhandledErrorResponse(error, request, currentRequestId);
  });
};

/** Global error formatting for all routes and hooks (onRequest, preHandler, etc.). */
export default fp(errorHandlerMiddlewarePlugin, { name: 'error-handler-middleware' });
