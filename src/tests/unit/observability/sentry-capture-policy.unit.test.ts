import { describe, expect, it } from 'vitest';
import { shouldCaptureErrorInSentry } from '@/infrastructure/observability/sentry/sentry.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/shared/errors/index.js';

/**
 * Capture policy for the Fastify error handler (`Sentry.setupFastifyErrorHandler`).
 *
 * The handler used to capture EVERY routed error, so ordinary client outcomes —
 * a request with no bearer token, a failed validation, an unknown id — arrived in
 * Sentry as error issues. That is noise an unauthenticated caller can generate at
 * will, and it buries genuine faults. The predicate keeps the handler aligned with
 * the app error handler, which has always captured only `statusCode >= 500`.
 */
describe('shouldCaptureErrorInSentry', () => {
  it('does not capture the 4xx AppErrors routes throw deliberately', () => {
    expect(
      shouldCaptureErrorInSentry(new UnauthorizedError('errors:missingAuthorizationHeader')),
    ).toBe(false);
    expect(shouldCaptureErrorInSentry(new ForbiddenError('errors:originNotAllowed'))).toBe(false);
    expect(shouldCaptureErrorInSentry(new NotFoundError('errors:notFound'))).toBe(false);
    expect(shouldCaptureErrorInSentry(new ValidationError('errors:invalidField'))).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 422, 429, 499])('does not capture status %i', (statusCode) => {
    expect(shouldCaptureErrorInSentry(Object.assign(new Error('client'), { statusCode }))).toBe(
      false,
    );
  });

  it.each([500, 502, 503, 504])('captures server fault status %i', (statusCode) => {
    expect(shouldCaptureErrorInSentry(Object.assign(new Error('server'), { statusCode }))).toBe(
      true,
    );
  });

  it('captures unclassified throws that carry no numeric statusCode', () => {
    expect(shouldCaptureErrorInSentry(new Error('boom'))).toBe(true);
    expect(shouldCaptureErrorInSentry(new TypeError('undefined is not a function'))).toBe(true);
    // A non-numeric statusCode is not a classification — treat it as unclassified.
    expect(shouldCaptureErrorInSentry(Object.assign(new Error('odd'), { statusCode: '404' }))).toBe(
      true,
    );
  });

  it('captures non-Error throws without crashing on null/undefined', () => {
    expect(shouldCaptureErrorInSentry(null)).toBe(true);
    expect(shouldCaptureErrorInSentry(undefined)).toBe(true);
    expect(shouldCaptureErrorInSentry('string throw')).toBe(true);
  });
});
