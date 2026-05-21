import { AppError } from './app.error.js';

export class GoneError extends AppError {
  constructor(
    messageKey = 'errors:gone',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('GONE', 410, messageKey, messageParams, fallbackMessage);
  }
}

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

export class UnauthorizedError extends AppError {
  constructor(
    messageKey = 'errors:unauthorized',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('UNAUTHORIZED', 401, messageKey, messageParams, fallbackMessage);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    messageKey = 'errors:forbidden',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('FORBIDDEN', 403, messageKey, messageParams, fallbackMessage);
  }
}

export class ConflictError extends AppError {
  constructor(
    messageKey = 'errors:conflict',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('CONFLICT', 409, messageKey, messageParams, fallbackMessage);
  }
}

export class NotImplementedError extends AppError {
  constructor(
    messageKey = 'errors:notImplemented',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('NOT_IMPLEMENTED', 501, messageKey, messageParams, fallbackMessage);
  }
}

export class RateLimitedError extends AppError {
  constructor(
    messageKey = 'errors:rateLimited',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('RATE_LIMITED', 429, messageKey, messageParams, fallbackMessage);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
    messageKey = 'errors:payloadTooLarge',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('PAYLOAD_TOO_LARGE', 413, messageKey, messageParams, fallbackMessage);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(
    messageKey = 'errors:unprocessableEntity',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('UNPROCESSABLE_ENTITY', 422, messageKey, messageParams, fallbackMessage);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    messageKey = 'errors:serviceUnavailable',
    messageParams?: Record<string, string | number>,
    fallbackMessage?: string,
  ) {
    super('SERVICE_UNAVAILABLE', 503, messageKey, messageParams, fallbackMessage);
  }
}
