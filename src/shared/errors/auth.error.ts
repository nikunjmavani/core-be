import { AppError } from './app.error.js';

/** 410 Gone — resource intentionally retired (e.g. revoked invite, deleted endpoint). */
export class GoneError extends AppError {
  constructor(
    messageKey = 'errors:gone',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('GONE', 410, messageKey, messageParams, fallbackMessage);
  }
}

/**
 * 404 Not Found — first argument doubles as the `{resource}` interpolation
 * for `errors:notFound` (e.g. `new NotFoundError('Organization')` →
 * "Organization not found").
 */
export class NotFoundError extends AppError {
  constructor(
    resourceOrMessageKey: string,
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super(
      'NOT_FOUND',
      404,
      'errors:notFound',
      { resource: resourceOrMessageKey, ...messageParams },
      fallbackMessage,
    );
  }
}

/** 401 Unauthorized — caller is not authenticated (missing or invalid credentials). */
export class UnauthorizedError extends AppError {
  constructor(
    messageKey = 'errors:unauthorized',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('UNAUTHORIZED', 401, messageKey, messageParams, fallbackMessage);
  }
}

/** 403 Forbidden — caller is authenticated but lacks the required permission/role. */
export class ForbiddenError extends AppError {
  constructor(
    messageKey = 'errors:forbidden',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('FORBIDDEN', 403, messageKey, messageParams, fallbackMessage);
  }
}

/** 409 Conflict — request conflicts with current state (e.g. duplicate slug, version mismatch). */
export class ConflictError extends AppError {
  constructor(
    messageKey = 'errors:conflict',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('CONFLICT', 409, messageKey, messageParams, fallbackMessage);
  }
}

/** 501 Not Implemented — feature flag is off or the endpoint is intentionally unimplemented. */
export class NotImplementedError extends AppError {
  constructor(
    messageKey = 'errors:notImplemented',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('NOT_IMPLEMENTED', 501, messageKey, messageParams, fallbackMessage);
  }
}

/** 429 Too Many Requests — rate limit exceeded; pair with `Retry-After` header where useful. */
export class RateLimitedError extends AppError {
  constructor(
    messageKey = 'errors:rateLimited',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('RATE_LIMITED', 429, messageKey, messageParams, fallbackMessage);
  }
}

/** 413 Payload Too Large — request body exceeds the route or upload size limit. */
export class PayloadTooLargeError extends AppError {
  constructor(
    messageKey = 'errors:payloadTooLarge',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('PAYLOAD_TOO_LARGE', 413, messageKey, messageParams, fallbackMessage);
  }
}

/** 422 Unprocessable Entity — request is well-formed but semantically invalid (business rule violation). */
export class UnprocessableEntityError extends AppError {
  constructor(
    messageKey = 'errors:unprocessableEntity',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('UNPROCESSABLE_ENTITY', 422, messageKey, messageParams, fallbackMessage);
  }
}

/** 503 Service Unavailable — dependency outage / circuit-breaker open / temporary maintenance. */
export class ServiceUnavailableError extends AppError {
  constructor(
    messageKey = 'errors:serviceUnavailable',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('SERVICE_UNAVAILABLE', 503, messageKey, messageParams, fallbackMessage);
  }
}
