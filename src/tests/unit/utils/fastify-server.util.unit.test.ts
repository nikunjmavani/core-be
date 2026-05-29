import { describe, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import {
  PINO_REDACT_PATHS,
  buildFastifyServerOptions,
} from '@/shared/utils/http/fastify-server.util.js';

const envState = vi.hoisted(() => ({
  LOG_LEVEL: 'info',
  NODE_ENV: 'test' as string,
  TRUST_PROXY: false as boolean | number | undefined,
  FASTIFY_REQUEST_TIMEOUT_MS: undefined as number | undefined,
  FASTIFY_CONNECTION_TIMEOUT_MS: undefined as number | undefined,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  get env() {
    return envState;
  },
}));

describe('fastify-server.util', () => {
  it('exports redact paths for sensitive fields', () => {
    expect(PINO_REDACT_PATHS).toContain('authorization');
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie');
  });

  it('buildFastifyServerOptions uses env log level and disables trust proxy in test', () => {
    const options = buildFastifyServerOptions();
    expect(options.logger).toMatchObject({ level: 'info' });
    expect(options.trustProxy).toBe(false);
    expect(options.bodyLimit).toBe(1_048_576);
    expect(options.requestTimeout).toBe(30_000);
    expect(options.connectionTimeout).toBe(10_000);
  });

  it('buildFastifyServerOptions honors FASTIFY_REQUEST_TIMEOUT_MS and FASTIFY_CONNECTION_TIMEOUT_MS', async () => {
    envState.FASTIFY_REQUEST_TIMEOUT_MS = 45_000;
    envState.FASTIFY_CONNECTION_TIMEOUT_MS = 15_000;
    vi.resetModules();
    const { buildFastifyServerOptions: buildTimeoutOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    const options = buildTimeoutOptions();
    expect(options.requestTimeout).toBe(45_000);
    expect(options.connectionTimeout).toBe(15_000);
    envState.FASTIFY_REQUEST_TIMEOUT_MS = undefined;
    envState.FASTIFY_CONNECTION_TIMEOUT_MS = undefined;
    vi.resetModules();
  });

  it('genReqId prefers X-Request-Id header when present', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': 'trace-abc' };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toBe('trace-abc');
  });

  it('disables trust proxy when TRUST_PROXY is unset', async () => {
    envState.NODE_ENV = 'production';
    envState.TRUST_PROXY = undefined;
    vi.resetModules();
    const { buildFastifyServerOptions: buildProductionOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildProductionOptions().trustProxy).toBe(false);
    envState.NODE_ENV = 'test';
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('honors TRUST_PROXY hop count', async () => {
    envState.TRUST_PROXY = 2;
    vi.resetModules();
    const { buildFastifyServerOptions: buildHopCountOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildHopCountOptions().trustProxy).toBe(2);
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('genReqId uses first array header value when x-request-id is an array', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': ['trace-array', 'ignored'] };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toBe('trace-array');
  });

  it('honors explicit TRUST_PROXY=false in production', async () => {
    envState.NODE_ENV = 'production';
    envState.TRUST_PROXY = false;
    vi.resetModules();
    const { buildFastifyServerOptions: buildProductionOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildProductionOptions().trustProxy).toBe(false);
    envState.NODE_ENV = 'test';
    vi.resetModules();
  });

  it('does not enable unbounded trust proxy from a boolean true value', async () => {
    envState.TRUST_PROXY = true;
    envState.NODE_ENV = 'test';
    vi.resetModules();
    const { buildFastifyServerOptions: buildTrustedProxyOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildTrustedProxyOptions().trustProxy).toBe(false);
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('genReqId generates UUID when header is absent', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = {};

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('genReqId generates UUID when x-request-id header is empty', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': '' };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('uses pino-pretty transport in local environment', async () => {
    envState.NODE_ENV = 'local';
    envState.TRUST_PROXY = false;
    vi.resetModules();
    const { buildFastifyServerOptions: buildLocalOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    const options = buildLocalOptions();
    expect(options.logger).toMatchObject({
      transport: expect.objectContaining({ target: 'pino-pretty' }),
    });
    envState.NODE_ENV = 'test';
    vi.resetModules();
  });
});
