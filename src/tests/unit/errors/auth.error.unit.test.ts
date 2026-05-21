import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotImplementedError,
  PayloadTooLargeError,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthorizedError,
  UnprocessableEntityError,
} from '@/shared/errors/auth.error.js';

describe('auth errors', () => {
  it('NotFoundError uses resource in messageParams', () => {
    const error = new NotFoundError('User');
    expect(error.statusCode).toBe(404);
    expect(error.messageKey).toBe('errors:notFound');
    expect(error.messageParams?.resource).toBe('User');
  });

  it('NotFoundError uses messageKey as fallback when custom fallback omitted', () => {
    const error = new NotFoundError('Plan');
    expect(error.message).toBe('errors:notFound');
  });

  it('NotFoundError accepts custom fallback message', () => {
    const error = new NotFoundError('Plan', undefined, 'Plan not found');
    expect(error.message).toBe('Plan not found');
  });

  it('UnauthorizedError accepts custom messageKey', () => {
    const error = new UnauthorizedError('errors:missingAuthorizationHeader');
    expect(error.messageKey).toBe('errors:missingAuthorizationHeader');
  });

  it('ForbiddenError accepts custom messageKey and params', () => {
    const error = new ForbiddenError('errors:insufficientRolePrivileges', { role: 'admin' });
    expect(error.messageKey).toBe('errors:insufficientRolePrivileges');
    expect(error.messageParams?.role).toBe('admin');
  });

  it('UnauthorizedError defaults to 401 unauthorized key', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.messageKey).toBe('errors:unauthorized');
    expect(error.message).toBe('errors:unauthorized');
  });

  it('ForbiddenError defaults to 403', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
  });

  it('ConflictError defaults to 409', () => {
    const error = new ConflictError();
    expect(error.statusCode).toBe(409);
  });

  it('RateLimitedError defaults to 429', () => {
    const error = new RateLimitedError();
    expect(error.statusCode).toBe(429);
  });

  it('PayloadTooLargeError defaults to 413', () => {
    const error = new PayloadTooLargeError();
    expect(error.statusCode).toBe(413);
  });

  it('UnprocessableEntityError defaults to 422', () => {
    const error = new UnprocessableEntityError();
    expect(error.statusCode).toBe(422);
  });

  it('ServiceUnavailableError defaults to 503', () => {
    const error = new ServiceUnavailableError();
    expect(error.statusCode).toBe(503);
  });

  it('NotImplementedError defaults to 501', () => {
    const error = new NotImplementedError();
    expect(error.statusCode).toBe(501);
  });
});
