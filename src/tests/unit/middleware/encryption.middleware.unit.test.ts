import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/shared/errors/app.error.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

// Note: the registration-time env guards (`ENABLE_RESPONSE_ENCRYPTION` off, missing
// `RESPONSE_ENCRYPTION_KEY`) need a separate resetModules/env-mock harness to exercise and are
// tracked as a follow-up; this file covers the request-path (onSend) behaviour.

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

function buildReply(
  options: {
    contentType?: unknown;
    config?: { raw_response?: boolean; skip_encryption?: boolean };
  } = {},
): FastifyReply {
  return {
    getHeader: (name: string) => (name === 'content-type' ? options.contentType : undefined),
    routeOptions: { config: options.config ?? {} },
  } as unknown as FastifyReply;
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
    // The failure must be logged with the offending URL (operational signal on fail-closed).
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ url: testApiPath('/test') }),
      'Response encryption failed',
    );
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

  // Each skip path must return the original payload untouched AND never invoke encryption.
  // A default success mock is set so that a mutant which wrongly *continues* to encryption
  // would change the payload (envelope) and trip the `toBe(original)` assertion too.
  describe('skip conditions (payload returned unchanged, never encrypted)', () => {
    const ORIGINAL = JSON.stringify({ secret: 'value' });

    async function runOnSend(
      request: Partial<FastifyRequest>,
      reply: FastifyReply,
      payload: unknown,
    ) {
      encryptPayloadMock.mockReturnValue({ payload: 'c', iv: 'i', authTag: 't' });
      application = Fastify();
      const onSend = await getOnSendHook(application);
      return onSend(request as FastifyRequest, reply, payload);
    }

    it('passes non-API routes through (e.g. health checks, dashboards)', async () => {
      const result = await runOnSend(
        { url: '/health' },
        buildReply({ contentType: 'application/json' }),
        ORIGINAL,
      );
      expect(result).toBe(ORIGINAL);
      expect(encryptPayloadMock).not.toHaveBeenCalled();
    });

    it('skips routes flagged raw_response', async () => {
      const result = await runOnSend(
        { url: testApiPath('/raw') },
        buildReply({ contentType: 'application/json', config: { raw_response: true } }),
        ORIGINAL,
      );
      expect(result).toBe(ORIGINAL);
      expect(encryptPayloadMock).not.toHaveBeenCalled();
    });

    it('skips routes flagged skip_encryption', async () => {
      const result = await runOnSend(
        { url: testApiPath('/opt-out') },
        buildReply({ contentType: 'application/json', config: { skip_encryption: true } }),
        ORIGINAL,
      );
      expect(result).toBe(ORIGINAL);
      expect(encryptPayloadMock).not.toHaveBeenCalled();
    });

    it('skips non-JSON responses', async () => {
      const result = await runOnSend(
        { url: testApiPath('/html') },
        buildReply({ contentType: 'text/html; charset=utf-8' }),
        '<html></html>',
      );
      expect(result).toBe('<html></html>');
      expect(encryptPayloadMock).not.toHaveBeenCalled();
    });

    it('skips when the content-type header is absent', async () => {
      const result = await runOnSend(
        { url: testApiPath('/no-ct') },
        buildReply({ contentType: undefined }),
        ORIGINAL,
      );
      expect(result).toBe(ORIGINAL);
      expect(encryptPayloadMock).not.toHaveBeenCalled();
    });

    it('skips non-string payloads (streams/buffers/null)', async () => {
      const buffer = Buffer.from('binary');
      const result = await runOnSend(
        { url: testApiPath('/binary') },
        buildReply({ contentType: 'application/json' }),
        buffer,
      );
      expect(result).toBe(buffer);
      expect(encryptPayloadMock).not.toHaveBeenCalled();
    });
  });
});
