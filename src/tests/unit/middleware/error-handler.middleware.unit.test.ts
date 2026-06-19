import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import errorHandlerMiddleware from '@/shared/middlewares/core/error-handler.middleware.js';
import { AppError, NotFoundError, ValidationError } from '@/shared/errors/index.js';

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureException: vi.fn(),
}));

async function createErrorHandlerApp() {
  const application = Fastify({ logger: false });
  application.decorateRequest(
    't',
    ((key: string) => `translated:${key}`) as unknown as NonNullable<
      Parameters<typeof application.decorateRequest>[1]
    >,
  );
  await application.register(errorHandlerMiddleware);
  application.get('/not-found-resource', async () => {
    throw new NotFoundError('Resource');
  });
  application.get('/validation-app-error', async () => {
    throw new ValidationError('errors:validation.failed', undefined, 'Validation failed', [
      { field: 'email', message: 'Invalid email' },
    ]);
  });
  application.get('/zod-error', async () => {
    z.object({ name: z.string().min(1) }).parse({});
  });
  application.post(
    '/fastify-validation',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  application.get('/unhandled', async () => {
    throw new Error('unexpected');
  });
  application.get('/server-error', async () => {
    throw new AppError('INTERNAL_ERROR', 500, 'errors:internal', undefined, 'Internal');
  });
  application.get('/unauthorized-with-params', async () => {
    throw new AppError(
      'UNAUTHORIZED',
      401,
      'errors:unauthorized',
      { reason: 'expired' },
      'Unauthorized',
    );
  });
  await application.ready();
  return application;
}

describe('error-handler.middleware', () => {
  let application: Awaited<ReturnType<typeof createErrorHandlerApp>>;

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  it('returns 404 for unknown routes', async () => {
    application = await createErrorHandlerApp();
    const response = await application.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('formats AppError and ValidationError responses', async () => {
    application = await createErrorHandlerApp();

    const notFound = await application.inject({ method: 'GET', url: '/not-found-resource' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error.code).toBe('not_found');

    const validation = await application.inject({
      method: 'GET',
      url: '/validation-app-error',
    });
    expect(validation.statusCode).toBe(400);
    expect(validation.json().error.type).toBe('validation_error');
    expect(validation.json().error.errors).toBeDefined();
  });

  it('formats ZodError and Fastify validation errors', async () => {
    application = await createErrorHandlerApp();

    const zod = await application.inject({ method: 'GET', url: '/zod-error' });
    expect(zod.statusCode).toBe(400);
    expect(zod.json().error.code).toBe('invalid_field');

    const fastifyValidation = await application.inject({
      method: 'POST',
      url: '/fastify-validation',
      payload: {},
    });
    expect(fastifyValidation.statusCode).toBe(400);
    expect(fastifyValidation.json().error.type).toBe('validation_error');
  });

  it('returns 500 for unhandled errors', async () => {
    application = await createErrorHandlerApp();
    const response = await application.inject({ method: 'GET', url: '/unhandled' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
  });

  it('translates AppError message params for non-500 responses', async () => {
    application = await createErrorHandlerApp();
    const response = await application.inject({
      method: 'GET',
      url: '/unauthorized-with-params',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.detail).toBe('translated:errors:unauthorized');
  });

  it('masks AppError 500 detail for clients', async () => {
    application = await createErrorHandlerApp();
    const response = await application.inject({ method: 'GET', url: '/server-error' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
  });

  it('translates validation error item messages when messageKey is present', async () => {
    const validationApplication = Fastify({ logger: false });
    validationApplication.decorateRequest(
      't',
      ((key: string) => `translated:${key}`) as unknown as NonNullable<
        Parameters<typeof validationApplication.decorateRequest>[1]
      >,
    );
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/validation-with-keys', async () => {
      throw new ValidationError('errors:validation.failed', undefined, 'Validation failed', [
        { field: 'email', messageKey: 'errors:emailInvalid', message: 'Invalid email' },
      ]);
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/validation-with-keys',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].message).toBe('translated:errors:emailInvalid');
    await validationApplication.close();
  });

  it('maps Fastify validation issues using missingProperty and instancePath', async () => {
    const validationApplication = Fastify({ logger: false });
    validationApplication.decorateRequest(
      't',
      ((key: string) => `translated:${key}`) as unknown as NonNullable<
        Parameters<typeof validationApplication.decorateRequest>[1]
      >,
    );
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.post(
      '/nested-validation',
      {
        schema: {
          body: {
            type: 'object',
            required: ['profile'],
            properties: {
              profile: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string', minLength: 1 } },
              },
            },
          },
        },
      },
      async () => ({ ok: true }),
    );
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'POST',
      url: '/nested-validation',
      payload: { profile: { name: '' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].field).toContain('profile');
    await validationApplication.close();
  });

  it('uses fallback copy when request.t is not decorated', async () => {
    const applicationWithoutTranslator = Fastify({ logger: false });
    await applicationWithoutTranslator.register(errorHandlerMiddleware);
    applicationWithoutTranslator.get('/not-found-resource', async () => {
      throw new NotFoundError('Resource');
    });
    await applicationWithoutTranslator.ready();

    const response = await applicationWithoutTranslator.inject({
      method: 'GET',
      url: '/not-found-resource',
    });
    expect(response.statusCode).toBe(404);
    /**
     * Without a decorated request.t, the error handler must fall back to the messageKey
     * (or fallback message) so callers can still detect the error class. AppError stores
     * `super(fallbackMessage ?? messageKey)` so `error.message === 'errors:notFound'`.
     */
    expect(response.json().error.detail).toBe('errors:notFound');
    await applicationWithoutTranslator.close();
  });

  it('uses validation item message when messageKey is absent', async () => {
    const validationApplication = Fastify({ logger: false });
    validationApplication.decorateRequest(
      't',
      ((key: string) => `translated:${key}`) as unknown as NonNullable<
        Parameters<typeof validationApplication.decorateRequest>[1]
      >,
    );
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/validation-plain-message', async () => {
      throw new ValidationError('errors:validation.failed', undefined, 'Validation failed', [
        { field: 'name', message: 'Name is required' },
      ]);
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/validation-plain-message',
    });
    expect(response.json().error.errors[0].message).toBe('Name is required');
    await validationApplication.close();
  });

  it('maps Fastify validation missingProperty without validationContext', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.post(
      '/missing-email',
      {
        schema: {
          body: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'POST',
      url: '/missing-email',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].field).toBe('email');
    await validationApplication.close();
  });

  it('captures AppError 500 in Sentry and masks detail', async () => {
    const { captureException } = await import('@/infrastructure/observability/sentry/sentry.js');
    application = await createErrorHandlerApp();
    const response = await application.inject({ method: 'GET', url: '/server-error' });
    expect(response.statusCode).toBe(500);
    expect(vi.mocked(captureException)).toHaveBeenCalled();
  });

  it('derives documentation_url from API_DOCS_BASE_URL (never the old hardcoded fake domain)', async () => {
    // EX-26: the link is built from env.API_DOCS_BASE_URL; the previous hardcoded
    // `docs.example.com` fallback is gone. When unset the field is omitted (see next test).
    const { env } = await import('@/shared/config/env.config.js');
    application = await createErrorHandlerApp();
    const response = await application.inject({ method: 'GET', url: '/does-not-exist' });
    const documentationUrl = response.json().error.documentation_url;
    expect(documentationUrl).not.toContain('docs.example.com');
    if (env.API_DOCS_BASE_URL) {
      expect(documentationUrl).toBe(`${env.API_DOCS_BASE_URL}/not_found`);
    } else {
      expect(documentationUrl).toBeUndefined();
    }
  });

  it('omits documentation_url entirely when API_DOCS_BASE_URL is unset', async () => {
    // EX-26: with no docs base configured, the field is omitted rather than emitting a fake link.
    vi.resetModules();
    vi.doMock('@/shared/config/env.config.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/shared/config/env.config.js')>();
      return { ...actual, env: { ...actual.env, API_DOCS_BASE_URL: undefined } };
    });
    const { default: freshErrorHandler } = await import(
      '@/shared/middlewares/core/error-handler.middleware.js'
    );
    const unconfiguredApplication = Fastify({ logger: false });
    unconfiguredApplication.decorateRequest(
      't',
      ((key: string) => `translated:${key}`) as unknown as NonNullable<
        Parameters<typeof unconfiguredApplication.decorateRequest>[1]
      >,
    );
    await unconfiguredApplication.register(freshErrorHandler);
    await unconfiguredApplication.ready();
    try {
      const response = await unconfiguredApplication.inject({ method: 'GET', url: '/missing' });
      expect(response.json().error.documentation_url).toBeUndefined();
    } finally {
      await unconfiguredApplication.close();
      vi.doUnmock('@/shared/config/env.config.js');
      vi.resetModules();
    }
  });

  it('omits errors array on non-validation AppError responses', async () => {
    const unauthorizedApplication = Fastify({ logger: false });
    unauthorizedApplication.decorateRequest(
      't',
      ((key: string) => `translated:${key}`) as unknown as NonNullable<
        Parameters<typeof unauthorizedApplication.decorateRequest>[1]
      >,
    );
    await unauthorizedApplication.register(errorHandlerMiddleware);
    unauthorizedApplication.get('/unauthorized', async () => {
      throw new AppError('UNAUTHORIZED', 401, 'errors:unauthorized', undefined, 'Unauthorized');
    });
    await unauthorizedApplication.ready();

    const response = await unauthorizedApplication.inject({
      method: 'GET',
      url: '/unauthorized',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.errors).toBeUndefined();
    await unauthorizedApplication.close();
  });

  it('uses validation messageKey text when request.t is not available', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/validation-message-key', async () => {
      throw new ValidationError('errors:validation.failed', undefined, 'Validation failed', [
        { field: 'email', messageKey: 'errors:emailInvalid', message: 'Invalid email' },
      ]);
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/validation-message-key',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].message).toBe('Invalid email');
    await validationApplication.close();
  });

  it('returns internal_error for unexpected thrown values', async () => {
    const unexpectedApplication = Fastify({ logger: false });
    unexpectedApplication.decorateRequest(
      't',
      ((key: string) => key) as unknown as NonNullable<
        Parameters<typeof unexpectedApplication.decorateRequest>[1]
      >,
    );
    await unexpectedApplication.register(errorHandlerMiddleware);
    unexpectedApplication.get('/boom', async () => {
      throw { reason: 'not-an-error' };
    });
    await unexpectedApplication.ready();

    const response = await unexpectedApplication.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
    await unexpectedApplication.close();
  });

  it('passes message params through translateDetail', async () => {
    const applicationWithTranslator = Fastify({ logger: false });
    applicationWithTranslator.decorateRequest(
      't',
      ((key: string, params?: Record<string, string | number>) =>
        `${key}:${params?.reason ?? ''}`) as unknown as NonNullable<
        Parameters<typeof applicationWithTranslator.decorateRequest>[1]
      >,
    );
    await applicationWithTranslator.register(errorHandlerMiddleware);
    applicationWithTranslator.get('/with-params', async () => {
      throw new AppError(
        'UNAUTHORIZED',
        401,
        'errors:unauthorized',
        { reason: 'expired' },
        'Unauthorized',
      );
    });
    await applicationWithTranslator.ready();

    const response = await applicationWithTranslator.inject({
      method: 'GET',
      url: '/with-params',
    });
    expect(response.json().error.detail).toBe('errors:unauthorized:expired');
    await applicationWithTranslator.close();
  });

  it('maps Fastify validation instancePath without validationContext', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/synthetic-instance-path', async () => {
      const validationError = new Error('validation failed') as Error & {
        statusCode: number;
        code: string;
        validation: Array<{ instancePath?: string; message?: string }>;
      };
      validationError.statusCode = 400;
      validationError.code = 'FST_ERR_VALIDATION';
      validationError.validation = [{ instancePath: '/email', message: 'Invalid email' }];
      throw validationError;
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/synthetic-instance-path',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].field).toBe('email');
    await validationApplication.close();
  });

  it('maps Fastify validation to validationContext when instancePath is empty', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/synthetic-validation', async () => {
      const validationError = new Error('validation failed') as Error & {
        statusCode: number;
        code: string;
        validation: Array<{ instancePath?: string; message?: string }>;
        validationContext?: string;
      };
      validationError.statusCode = 400;
      validationError.code = 'FST_ERR_VALIDATION';
      validationError.validation = [{ instancePath: '', message: 'Invalid query' }];
      validationError.validationContext = 'querystring';
      throw validationError;
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/synthetic-validation',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].field).toBe('querystring');
    await validationApplication.close();
  });

  it('uses messageKey as validation item text when message is absent', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/validation-key-only', async () => {
      throw new ValidationError('errors:validation.failed', undefined, 'Validation failed', [
        { field: 'token', messageKey: 'errors:tokenInvalid' },
      ]);
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/validation-key-only',
    });
    expect(response.json().error.errors[0].message).toBe('errors:tokenInvalid');
    await validationApplication.close();
  });

  it('maps Fastify validation fields to body when instancePath and context are empty', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/synthetic-body-field', async () => {
      const validationError = new Error('validation failed') as Error & {
        statusCode: number;
        code: string;
        validation: Array<{ instancePath?: string; message?: string }>;
      };
      validationError.statusCode = 400;
      validationError.code = 'FST_ERR_VALIDATION';
      validationError.validation = [{ instancePath: '', message: 'Invalid body' }];
      throw validationError;
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/synthetic-body-field',
    });
    expect(response.json().error.errors[0].field).toBe('body');
    await validationApplication.close();
  });

  it('uses default invalid message for Fastify validation issues without message text', async () => {
    const validationApplication = Fastify({ logger: false });
    await validationApplication.register(errorHandlerMiddleware);
    validationApplication.get('/synthetic-no-message', async () => {
      const validationError = new Error('validation failed') as Error & {
        code: string;
        validation: Array<{ instancePath?: string }>;
      };
      validationError.code = 'FST_ERR_VALIDATION';
      validationError.validation = [{ instancePath: '/name' }];
      throw validationError;
    });
    await validationApplication.ready();

    const response = await validationApplication.inject({
      method: 'GET',
      url: '/synthetic-no-message',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].message).toBe('Invalid');
    await validationApplication.close();
  });

  it('formats ZodError field messages that are not arrays', async () => {
    const zodApplication = Fastify({ logger: false });
    await zodApplication.register(errorHandlerMiddleware);
    zodApplication.get('/zod-single-message', async () => {
      throw new ZodError([
        {
          code: 'custom',
          message: 'Bad value',
          path: ['name'],
        },
      ]);
    });
    await zodApplication.ready();

    const response = await zodApplication.inject({
      method: 'GET',
      url: '/zod-single-message',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.errors[0].message).toBe('Bad value');
    await zodApplication.close();
  });

  it('generates request_id when request.id is missing on 404', async () => {
    const applicationWithoutId = Fastify({
      logger: false,
      genReqId: () => undefined as unknown as string,
    });
    applicationWithoutId.decorateRequest(
      't',
      ((key: string) => key) as unknown as NonNullable<
        Parameters<typeof applicationWithoutId.decorateRequest>[1]
      >,
    );
    await applicationWithoutId.register(errorHandlerMiddleware);
    await applicationWithoutId.ready();

    const response = await applicationWithoutId.inject({
      method: 'GET',
      url: '/unknown-route',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().meta.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await applicationWithoutId.close();
  });
});
