import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/shared/errors/app.error.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    ENABLE_RESPONSE_ENCRYPTION: true,
    RESPONSE_ENCRYPTION_KEY: 'a'.repeat(64),
  },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const encryptPayloadMock = vi.fn();

vi.mock('@/shared/utils/security/encryption.util.js', () => ({
  encryptPayload: (...arguments_: unknown[]) => encryptPayloadMock(...arguments_),
}));

import encryptionMiddleware from '@/shared/middlewares/security/encryption.middleware.js';

async function getOnSendHook(application: ReturnType<typeof Fastify>) {
  const addHook = vi.spyOn(application, 'addHook');
  await application.register(encryptionMiddleware);
  const onSendCall = addHook.mock.calls.find((call) => call[0] === 'onSend');
  expect(onSendCall).toBeDefined();
  return onSendCall![1] as (
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
  ) => Promise<unknown>;
}

describe('encryption.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    encryptPayloadMock.mockReset();
    vi.restoreAllMocks();
    if (application) {
      await application.close();
    }
  });

  it('throws AppError when encryptPayload fails (fail-closed)', async () => {
    encryptPayloadMock.mockImplementation(() => {
      throw new Error('encryption failed');
    });

    application = Fastify();
    const onSend = await getOnSendHook(application);

    await expect(
      onSend(
        { url: testApiPath('/test') } as FastifyRequest,
        {
          getHeader: (name: string) =>
            name === 'content-type' ? 'application/json; charset=utf-8' : undefined,
          routeOptions: { config: {} },
        } as FastifyReply,
        JSON.stringify({ secret: 'value' }),
      ),
    ).rejects.toBeInstanceOf(AppError);

    expect(encryptPayloadMock).toHaveBeenCalled();
  });

  it('returns encrypted envelope when encryption succeeds', async () => {
    encryptPayloadMock.mockReturnValue({
      payload: 'cipher',
      iv: 'iv-bytes',
      authTag: 'tag-bytes',
    });

    application = Fastify();
    const onSend = await getOnSendHook(application);

    const result = await onSend(
      { url: testApiPath('/test') } as FastifyRequest,
      {
        getHeader: (name: string) =>
          name === 'content-type' ? 'application/json; charset=utf-8' : undefined,
        routeOptions: { config: {} },
      } as FastifyReply,
      JSON.stringify({ secret: 'value' }),
    );

    expect(result).toBe(
      JSON.stringify({
        _encrypted: true,
        payload: 'cipher',
        iv: 'iv-bytes',
        authTag: 'tag-bytes',
      }),
    );
    expect(encryptPayloadMock).toHaveBeenCalled();
  });
});
